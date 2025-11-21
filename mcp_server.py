import os, asyncio, httpx, threading, re
from typing import Optional, List, Dict, Any
from dotenv import load_dotenv
from mcp.server import Server
from mcp.types import Tool, TextContent
import mcp.server.stdio
from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

load_dotenv()

# Config
AIRFLOW_API = os.getenv("AIRFLOW_API", "http://localhost:8080/api/v1")
AIRFLOW_USER = os.getenv("AIRFLOW_USER", "admin")
AIRFLOW_PASS = os.getenv("AIRFLOW_PASS", "admin")

class AirflowClient:
    def __init__(self):
        self.client: Optional[httpx.AsyncClient] = None
        self.base_url = AIRFLOW_API.rstrip('/')
        self.auth = (AIRFLOW_USER, AIRFLOW_PASS)
    
    async def initialize(self):
        self.client = httpx.AsyncClient(timeout=60.0, limits=httpx.Limits(max_connections=100))
        print(f"✅ Connected to Airflow: {self.base_url}")
    
    async def close(self):
        if self.client:
            await self.client.aclose()
    
    async def call(self, method: str, path: str, params=None, json_data=None) -> Dict:
        for i in range(3):
            try:
                r = await self.client.request(method, f"{self.base_url}{path}", 
                                             params=params or {}, json=json_data or {}, auth=self.auth)
                r.raise_for_status()
                return r.json() or {}
            except Exception as e:
                if i == 2: raise Exception(f"Airflow error: {e}")
                await asyncio.sleep(2 ** i)
    
    async def fetch_all_dags(self) -> List[Dict]:
        all_dags, offset = [], 0
        while True:
            data = await self.call("GET", "/dags", params={"limit": 100, "offset": offset})
            dags = data.get("dags", [])
            all_dags.extend(dags)
            if len(dags) < 100: break
            offset += 100
            await asyncio.sleep(0.05)
        return all_dags

# Initialize
server = Server("airflow-mcp")
client = AirflowClient()

# MCP Tools
@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(name="list_all_dags", description="List ALL DAGs (full pagination)", 
             inputSchema={"type": "object", "properties": {}}),
        Tool(name="search_dags", description="Search DAGs by name", 
             inputSchema={"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}),
        Tool(name="get_dag_details", description="Get DAG details", 
             inputSchema={"type": "object", "properties": {"dag_id": {"type": "string"}}, "required": ["dag_id"]}),
        Tool(name="pause_dag", description="Pause a DAG", 
             inputSchema={"type": "object", "properties": {"dag_id": {"type": "string"}}, "required": ["dag_id"]}),
        Tool(name="unpause_dag", description="Unpause a DAG", 
             inputSchema={"type": "object", "properties": {"dag_id": {"type": "string"}}, "required": ["dag_id"]}),
        Tool(name="trigger_dag", description="Trigger DAG run", 
             inputSchema={"type": "object", "properties": {"dag_id": {"type": "string"}, "conf": {"type": "object"}}, "required": ["dag_id"]}),
        Tool(name="get_latest_run", description="Get latest run status", 
             inputSchema={"type": "object", "properties": {"dag_id": {"type": "string"}}, "required": ["dag_id"]}),
    ]

@server.call_tool()
async def call_tool(name: str, arguments: Any) -> list[TextContent]:
    try:
        if name == "list_all_dags":
            dags = await client.fetch_all_dags()
            lines = [f"📊 Total: {len(dags)}\n"]
            for d in dags[:100]:
                s = "⏸ Paused" if d.get("is_paused") else "▶ Active"
                lines.append(f"• {d['dag_id']} | {s}")
            if len(dags) > 100: lines.append(f"...+{len(dags)-100} more")
            return [TextContent(type="text", text="\n".join(lines))]
        
        elif name == "search_dags":
            q = arguments["query"].lower()
            all_dags = await client.fetch_all_dags()
            matches = [d for d in all_dags if q in d["dag_id"].lower()]
            text = f"Found {len(matches)}:\n" + "\n".join([f"• {d['dag_id']}" for d in matches]) if matches else "No matches"
            return [TextContent(type="text", text=text)]
        
        elif name == "get_dag_details":
            data = await client.call("GET", f"/dags/{arguments['dag_id']}")
            d = data.get("dag", {})
            text = f"DAG: {d['dag_id']}\nStatus: {'Paused' if d.get('is_paused') else 'Active'}\nSchedule: {d.get('schedule_interval')}"
            return [TextContent(type="text", text=text)]
        
        elif name == "pause_dag":
            await client.call("PATCH", f"/dags/{arguments['dag_id']}", json_data={"is_paused": True})
            return [TextContent(type="text", text=f"✅ Paused '{arguments['dag_id']}'")]
        
        elif name == "unpause_dag":
            await client.call("PATCH", f"/dags/{arguments['dag_id']}", json_data={"is_paused": False})
            return [TextContent(type="text", text=f"✅ Unpaused '{arguments['dag_id']}'")]
        
        elif name == "trigger_dag":
            result = await client.call("POST", f"/dags/{arguments['dag_id']}/dagRuns", 
                                      json_data={"conf": arguments.get("conf", {})})
            return [TextContent(type="text", text=f"🚀 Triggered '{arguments['dag_id']}'\nRun: {result.get('dag_run_id')}")]
        
        elif name == "get_latest_run":
            data = await client.call("GET", f"/dags/{arguments['dag_id']}/dagRuns", 
                                    params={"limit": 1, "order_by": "-execution_date"})
            run = (data.get("dag_runs") or [None])[0]
            if not run: return [TextContent(type="text", text="No runs")]
            text = f"Run: {run['dag_run_id']}\nState: {run['state'].upper()}\nStarted: {run.get('start_date')}"
            return [TextContent(type="text", text=text)]
        
        else:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]
    
    except Exception as e:
        return [TextContent(type="text", text=f"Error: {str(e)}")]

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, 
                  allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
async def startup():
    await client.initialize()

@app.on_event("shutdown")
async def shutdown():
    await client.close()

def extract_dag_id(query: str) -> Optional[str]:
    """Extract DAG ID from natural language query"""
    patterns = [
        r'["\']([a-zA-Z0-9_\-:.]+)["\']', 
        r'\b([a-zA-Z0-9_]+(?:[_\-:.][a-zA-Z0-9_]+)+)\b',  
        r'dag[_\s]+([a-zA-Z0-9_\-:.]+)',  
        r'(?:for|of|on|named)\s+([a-zA-Z0-9_\-:.]+)', 
    ]
    
    for pattern in patterns:
        match = re.search(pattern, query, re.IGNORECASE)
        if match:
            dag_id = match.group(1)
            if dag_id.lower() not in ['all', 'dags', 'dag', 'list', 'show', 'get']:
                return dag_id
    return None

@app.post("/run")
async def run_query(body: Dict = Body(...)):
    query = str(body.get("query", "")).strip()
    query_lower = query.lower()
    
    try:
        # LIST DAGS
        if re.search(r'\b(list|show|get)\b.*\bdag', query_lower):
            dags = await client.fetch_all_dags()
            return {
                "success": True,
                "output": {
                    "dags": [{
                        "dag_id": d["dag_id"],
                        "is_paused": d.get("is_paused", False),
                        "is_active": d.get("is_active", True),
                        "description": d.get("description", ""),
                        "schedule_interval": d.get("schedule_interval"),
                        "owners": d.get("owners", []),
                        "tags": [t.get("name", "") for t in d.get("tags", [])],
                    } for d in dags],
                    "count": len(dags)
                }
            }
        
        # SEARCH DAGS
        search_match = re.search(r'search.*(?:for|dags?)\s+["\']?([a-zA-Z0-9_\-:.]+)', query, re.IGNORECASE)
        if search_match or 'search' in query_lower:
            search_term = search_match.group(1) if search_match else query_lower.split('search')[1].strip()
            all_dags = await client.fetch_all_dags()
            matches = [d for d in all_dags if search_term.lower() in d["dag_id"].lower()]
            return {
                "success": True,
                "output": {
                    "query": search_term,
                    "matches": len(matches),
                    "dags": [{"dag_id": d["dag_id"], "is_paused": d.get("is_paused")} for d in matches]
                }
            }
        
        # DAG DETAILS
        if re.search(r'\b(details?|info|status)\b', query_lower):
            dag_id = extract_dag_id(query)
            if dag_id:
                data = await client.call("GET", f"/dags/{dag_id}")
                dag_info = data.get("dag", {})
                return {
                    "success": True,
                    "output": {
                        "dag_id": dag_info.get("dag_id"),
                        "is_paused": dag_info.get("is_paused"),
                        "schedule_interval": dag_info.get("schedule_interval"),
                        "description": dag_info.get("description"),
                        "is_active": dag_info.get("is_active"),
                        "fileloc": dag_info.get("fileloc")
                    }
                }
            return {"success": False, "error": "Could not extract DAG ID from query"}
        if re.search(r'\bpause\b', query_lower):
            dag_id = extract_dag_id(query)
            if dag_id:
                # current status 
                current = await client.call("GET", f"/dags/{dag_id}")
                was_paused = current.get("dag", {}).get("is_paused", False)
                # Pause 
                await client.call("PATCH", f"/dags/{dag_id}", json_data={"is_paused": True})
                # Verify 
                updated = await client.call("GET", f"/dags/{dag_id}")
                is_now_paused = updated.get("dag", {}).get("is_paused", False)
                
                return {
                    "success": True,
                    "output": {
                        "action": "pause",
                        "dag_id": dag_id,
                        "was_paused": was_paused,
                        "is_now_paused": is_now_paused,
                        "message": f" DAG '{dag_id}' is now paused" if is_now_paused else f"DAG '{dag_id}' was already paused"
                    }
                }
            return {"success": False, "error": "Could not extract DAG ID from query"}
        
        # UNPAUSE DAG
        if re.search(r'\b(unpause|resume|activate|start)\b', query_lower):
            dag_id = extract_dag_id(query)
            if dag_id:
                current = await client.call("GET", f"/dags/{dag_id}")
                was_paused = current.get("dag", {}).get("is_paused", False)
                #hallelujah fix
                await client.call("PATCH", f"/dags/{dag_id}", json_data={"is_paused": False})
                updated = await client.call("GET", f"/dags/{dag_id}")
                is_now_paused = updated.get("dag", {}).get("is_paused", False)
                
                return {
                    "success": True,
                    "output": {
                        "action": "unpause",
                        "dag_id": dag_id,
                        "was_paused": was_paused,
                        "is_now_paused": is_now_paused,
                        "message": f"✅ DAG '{dag_id}' is now active" if not is_now_paused else f"⚠️ DAG '{dag_id}' was already active"
                    }
                }
            return {"success": False, "error": "Could not extract DAG ID from query"}
        if re.search(r'\b(trigger|run)\b', query_lower):
            dag_id = extract_dag_id(query)
            if dag_id:
                result = await client.call("POST", f"/dags/{dag_id}/dagRuns", 
                                          json_data={"conf": {}})
                return {
                    "success": True,
                    "output": {
                        "action": "trigger",
                        "dag_id": dag_id,
                        "dag_run_id": result.get("dag_run_id"),
                        "state": result.get("state"),
                        "execution_date": result.get("execution_date"),
                        "message": f"🚀 Triggered DAG '{dag_id}'"
                    }
                }
            return {"success": False, "error": "Could not extract DAG ID from query"}
        if re.search(r'\b(latest|last|recent)\s+run\b', query_lower):
            dag_id = extract_dag_id(query)
            if dag_id:
                data = await client.call("GET", f"/dags/{dag_id}/dagRuns", 
                                        params={"limit": 1, "order_by": "-execution_date"})
                runs = data.get("dag_runs", [])
                if runs:
                    run = runs[0]
                    return {
                        "success": True,
                        "output": {
                            "dag_id": dag_id,
                            "dag_run_id": run.get("dag_run_id"),
                            "state": run.get("state"),
                            "start_date": run.get("start_date"),
                            "end_date": run.get("end_date"),
                            "execution_date": run.get("execution_date")
                        }
                    }
                return {"success": True, "output": {"message": f"No runs found for DAG '{dag_id}'"}}
            return {"success": False, "error": "Could not extract DAG ID from query"}
        return {
            "success": False, 
            "error": f"Could not understand query: '{query}'. Supported: list dags, search, details, pause, unpause, trigger, latest run"
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
@app.get("/")
async def root():
    return {"server": "Airflow MCP - Hybrid", "status": "ready", "version": "2.0"}
def run_http():
    uvicorn.run(app, host="0.0.0.0", port=8800, log_level="info")
async def run_mcp():
    print("HTTP: http://localhost:8800")
    await client.initialize()
    async with mcp.server.stdio.stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())

def main():
    http_thread = threading.Thread(target=run_http, daemon=True)
    http_thread.start()
    try:
        asyncio.run(run_mcp())
    except KeyboardInterrupt:
        print("\n👋 Bye")

if __name__ == "__main__":
    main()
