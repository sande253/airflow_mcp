import React, { useState, useRef, useEffect } from "react";
import { Send, User, Database, Play, Pause, Search, Info, Clock, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const MCP_URL = "http://localhost:8800/run";
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY || ""; // put your key in env

const Chatbot = () => {
  const [messages, setMessages] = useState([
    { 
      sender: "bot", 
      text: "Hello! I'm your Airflow assistant. I can help you:\n\n• List and search DAGs\n• Get DAG details and status\n• Pause/unpause DAGs\n• Trigger DAG runs\n• Check latest run status\n\nTry asking: \"List all DAGs\" or \"Show me details for <dag_id>\"" 
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  // DAG display states
  const [dagList, setDagList] = useState([]);
  const [dagDetails, setDagDetails] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 15;

  const paginatedDags = dagList.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Typewriter placeholder
  const [placeholder, setPlaceholder] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const placeholderTexts = [
    "List all DAGs...",
    "Search for a DAG...",
    "Get details for my_dag...",
    "Pause production_dag...",
    "Trigger data_pipeline...",
    "Show latest run status..."
  ];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, dagList, dagDetails]);

  // Typewriter effect
  useEffect(() => {
    const currentText = placeholderTexts[placeholderIndex];
    const speed = isDeleting ? 30 : 80;

    if (!isDeleting && placeholder === currentText) {
      const t = setTimeout(() => setIsDeleting(true), 2000);
      return () => clearTimeout(t);
    }

    if (isDeleting && placeholder === "") {
      setIsDeleting(false);
      setPlaceholderIndex((p) => (p + 1) % placeholderTexts.length);
      return;
    }

    const t = setTimeout(() => {
      setPlaceholder((prev) =>
        isDeleting ? currentText.substring(0, prev.length - 1) : currentText.substring(0, prev.length + 1)
      );
    }, speed);

    return () => clearTimeout(t);
  }, [placeholder, isDeleting, placeholderIndex]);

  // Call MCP server
  const callMCPServer = async (query) => {
    try {
      const res = await fetch(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      return { ok: res.ok, status: res.status, body: data };
    } catch (err) {
      console.error("MCP Server error:", err);
      return { ok: false, status: 0, body: null, error: err.message };
    }
  };

  // Extract DAGs from MCP response
  const extractDags = (mcpBody) => {
    if (!mcpBody) return [];
    if (mcpBody.output?.dags) return mcpBody.output.dags;
    if (Array.isArray(mcpBody.dags)) return mcpBody.dags;
    if (Array.isArray(mcpBody.results)) return mcpBody.results;
    if (Array.isArray(mcpBody)) return mcpBody;
    return [];
  };

  // Parse MCP server response for display
  const parseMCPResponse = (body) => {
    // If it's a simple success response with a message
    if (!body) return "No response body.";
    if (body.success && body.message) {
      return body.message;
    }
    
    // If it's an error
    if (body.error) {
      return `❌ Error: ${body.error}`;
    }
    
    // Try to extract meaningful info from output
    if (body.output) {
      if (typeof body.output === 'string') {
        return body.output;
      }
      if (body.output.message) {
        return body.output.message;
      }
      if (body.output.state || body.output.status) {
        return `Status: ${body.output.state || body.output.status}`;
      }
    }
    
    // If body has useful top-level fields
    if (body.message) return body.message;
    if (body.data) return JSON.stringify(body.data, null, 2);
    
    // Return JSON for debugging if we can't parse it nicely
    try {
      return JSON.stringify(body, null, 2);
    } catch (err) {
      return String(body);
    }
  };

  // AI: send text to Groq and get a command back
  const sendToAI = async (text) => {
    if (!GROQ_API_KEY) {
      console.warn("GROQ API key missing (REACT_APP_GROQ_API_KEY).");
      return null;
    }

    try {
      const res = await fetch(GROQ_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "mixtral-8x7b",
          messages: [
            {
              role: "system",
              content: `
You are an Airflow Control Agent. Your job is to convert a user's natural language request into a single concise MCP command.
ONLY return the command string (no surrounding quotes, no markdown, no explanation).

Supported MCP commands (exact forms expected):
- list all dags
- search dags <term>
- get dag details <dag_id>
- get latest run <dag_id>
- pause dag <dag_id>
- unpause dag <dag_id>
- trigger dag <dag_id>

If the user asks multiple actions, return the primary desired action only.
If you cannot determine a dag_id or term, return a helpful command that uses 'list all dags' or 'search dags <term>' where term is the best guess.

Examples:
User: "pause analytics"
AI: pause dag analytics

User: "show me the latest run for my_dag"
AI: get latest run my_dag

User: "list dags"
AI: list all dags
`
            },
            { role: "user", content: text }
          ],
          temperature: 0.0,
          max_tokens: 256,
        }),
      });

      const data = await res.json();
      // Groq responses may place content in different fields depending on compatibility
      const content =
        data?.choices?.[0]?.message?.content ||
        data?.choices?.[0]?.text ||
        (typeof data === "string" ? data : null);

      if (!content) {
        console.error("AI returned no content:", data);
        return null;
      }

      // extract the first line and trim
      const firstLine = content.split("\n")[0].trim();
      return firstLine;
    } catch (err) {
      console.error("AI error:", err);
      return null;
    }
  };

  // Main message handler (AI-driven)
  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMsg = { sender: "user", text: input };
    setMessages((prev) => [...prev, userMsg]);
    const userQuery = input.trim();
    setInput("");
    setLoading(true);
    setDagDetails(null);

    try {
      // If Groq key missing: skip AI interpretation and fallback to existing heuristics
      if (!GROQ_API_KEY) {
        setMessages((prev) => [
          ...prev,
          { sender: "bot", text: "⚠️ Groq API key not configured. Falling back to local heuristics (no AI)." }
        ]);

        // naive fallback: send the raw query to MCP server
        const fallbackRes = await callMCPServer(userQuery);
        if (fallbackRes.ok) {
          const responseText = parseMCPResponse(fallbackRes.body);
          setMessages(prev => [...prev, { sender: "bot", text: responseText }]);
          const dags = extractDags(fallbackRes.body);
          if (dags.length > 0) {
            setDagList(dags);
            setCurrentPage(1);
          }
        } else {
          setMessages(prev => [...prev, { sender: "bot", text: `❌ MCP Server error (${fallbackRes.status})` }]);
        }
        setLoading(false);
        return;
      }

      // 1) AI interprets natural language -> MCP command
      setMessages(prev => [...prev, { sender: "bot", text: "🤖 Interpreting your request..." }]);
      const aiCommand = await sendToAI(userQuery);
      console.log("AI generated command:", aiCommand);

      if (!aiCommand) {
        setMessages((prev) => [...prev, { sender: "bot", text: "❌ AI could not interpret the request. Try rephrasing." }]);
        setLoading(false);
        return;
      }

      // show the interpreted command to the user
      setMessages((prev) => [...prev, { sender: "bot", text: `🔁 Interpreted as: \`${aiCommand}\`` }]);

      // 2) Call MCP server with the AI-generated command
      const result = await callMCPServer(aiCommand);
      console.log("MCP RESPONSE:", result);

      if (!result.ok) {
        setMessages((prev) => [
          ...prev,
          { sender: "bot", text: `❌ MCP Server error (${result.status}). Make sure the MCP server is running on ${MCP_URL}.` }
        ]);
        setLoading(false);
        return;
      }

      // 3) Parse and show results
      const responseText = parseMCPResponse(result.body);
      setMessages((prev) => [
        ...prev,
        { sender: "bot", text: responseText || "Request completed but no response data." }
      ]);

      // 4) Update DAG list / details if present
      const dags = extractDags(result.body);
      if (dags.length > 0) {
        setDagList(dags);
        setCurrentPage(1);
      } else {
        // if command was get dag details / get latest run, try to set dagDetails from body
        if (aiCommand.startsWith("get dag details") || aiCommand.startsWith("get latest run")) {
          // Attempt to synthesize details
          const dagId = aiCommand.split(/\s+/).slice(-1)[0];
          const details = { dag_id: dagId, ...result.body };
          setDagDetails(details);
        }
      }
    } catch (err) {
      console.error("Error in sendMessage:", err);
      setMessages((prev) => [...prev, { sender: "bot", text: `❌ Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="relative h-screen flex flex-col bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-slate-900 dark:to-indigo-950 overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20 dark:opacity-10">
        <div className="absolute top-20 left-10 w-96 h-96 bg-blue-400 dark:bg-blue-600 rounded-full mix-blend-multiply filter blur-3xl animate-blob"></div>
        <div className="absolute top-40 right-10 w-96 h-96 bg-purple-400 dark:bg-purple-600 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-20 left-1/2 w-96 h-96 bg-indigo-400 dark:bg-indigo-600 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000"></div>
      </div>

      {/* Header */}
      <div className="relative z-10 pt-6 pb-4 px-4 md:px-8">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <Database className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Airflow Assistant</h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">Manage your DAGs with natural language</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 md:px-8 pb-4">
        <div className="max-w-4xl mx-auto space-y-4">
          <AnimatePresence mode="wait">
            {messages.map((msg, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className={`flex gap-3 ${msg.sender === "user" ? "flex-row-reverse" : ""}`}
              >
                <div className="flex-shrink-0">
                  {msg.sender === "bot" ? (
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                      <Database className="text-white" size={18} />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-slate-700 dark:bg-slate-600 flex items-center justify-center shadow-lg">
                      <User className="text-white" size={18} />
                    </div>
                  )}
                </div>

                <div
                  className={`px-4 py-3 rounded-2xl shadow-md max-w-2xl ${msg.sender === "user"
                      ? "bg-slate-700 text-white rounded-tr-sm"
                      : "bg-white/90 dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 rounded-tl-sm backdrop-blur-sm"
                    }`}
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap font-mono">{msg.text}</p>
                </div>
              </motion.div>
            ))}

            {loading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                  <Database className="text-white" size={18} />
                </div>
                <div className="bg-white/90 dark:bg-slate-800/90 rounded-2xl rounded-tl-sm px-4 py-3 shadow-md flex items-center gap-2">
                  <div className="flex space-x-1">
                    {[0, 0.15, 0.3].map((delay) => (
                      <motion.div
                        key={delay}
                        className="w-2 h-2 bg-blue-500 rounded-full"
                        animate={{ y: [0, -6, 0] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay }}
                      />
                    ))}
                  </div>
                  <span className="text-sm text-slate-600 dark:text-slate-300">Processing...</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* DAG Details Card */}
          {dagDetails && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-6 rounded-2xl shadow-xl bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border border-slate-200/50 dark:border-slate-700/50"
            >
              <div className="flex items-center gap-3 mb-4">
                <Info className="text-blue-500" size={24} />
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                  {dagDetails.dag_id || "DAG Details"}
                </h3>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Status:</span>
                  <span className="ml-2 font-semibold">
                    {dagDetails.is_paused ? "⏸️ Paused" : "▶️ Active"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Schedule:</span>
                  <span className="ml-2 font-mono text-xs">{dagDetails.schedule_interval || "None"}</span>
                </div>
                {dagDetails.description && (
                  <div className="col-span-2">
                    <span className="text-slate-500 dark:text-slate-400">Description:</span>
                    <p className="mt-1 text-slate-700 dark:text-slate-200">{dagDetails.description}</p>
                  </div>
                )}
                {dagDetails.latest_run && (
                  <div className="col-span-2 mt-2 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="text-blue-500" size={18} />
                      <span className="font-semibold text-slate-700 dark:text-slate-200">Latest Run</span>
                    </div>
                    <div className="ml-7 space-y-1 text-xs">
                      <div>State: <span className="font-bold">{dagDetails.latest_run.state?.toUpperCase()}</span></div>
                      <div>Started: {dagDetails.latest_run.start_date || "N/A"}</div>
                      <div className="font-mono">{dagDetails.latest_run.dag_run_id}</div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* DAG List Table */}
          {dagList.length > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-6 rounded-2xl shadow-xl bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border border-slate-200/50 dark:border-slate-700/50"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Database className="text-blue-500" size={24} />
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                    DAGs — Page {currentPage} of {Math.ceil(dagList.length / PAGE_SIZE)}
                  </h3>
                </div>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  Total: {dagList.length}
                </span>
              </div>
              
              <div className="overflow-x-auto rounded-xl border border-slate-200/50 dark:border-slate-700/50">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white">
                    <tr>
                      <th className="px-4 py-3 font-semibold">#</th>
                      <th className="px-4 py-3 font-semibold">DAG ID</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Schedule</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700 dark:text-slate-200">
                    {paginatedDags.map((dag, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-slate-200/50 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition"
                      >
                        <td className="px-4 py-3 text-slate-500">{(currentPage - 1) * PAGE_SIZE + idx + 1}</td>
                        <td className="px-4 py-3 font-mono font-medium">{dag.dag_id || dag}</td>
                        <td className="px-4 py-3">
                          {dag.is_paused ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 text-xs">
                              <Pause size={12} /> Paused
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs">
                              <Play size={12} /> Active
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                          {dag.schedule_interval || dag.schedule || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="flex justify-between items-center mt-4">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                  className="px-4 py-2 rounded-xl font-medium shadow-md bg-slate-200 dark:bg-slate-700 disabled:opacity-40 hover:bg-slate-300 dark:hover:bg-slate-600 transition"
                >
                  ← Previous
                </button>
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, dagList.length)} of {dagList.length}
                </span>
                <button
                  disabled={currentPage >= Math.ceil(dagList.length / PAGE_SIZE)}
                  onClick={() => setCurrentPage((p) => p + 1)}
                  className="px-4 py-2 rounded-xl font-medium shadow-md bg-blue-500 text-white disabled:opacity-40 hover:bg-blue-600 transition"
                >
                  Next →
                </button>
              </div>
            </motion.div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="relative z-10 px-4 pb-6 md:px-8"
      >
        <div className="max-w-4xl mx-auto">
          <div className="relative bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/60 dark:border-slate-700/60 overflow-hidden transition-all focus-within:ring-4 focus-within:ring-blue-400/20">
            <textarea
              placeholder={placeholder + (placeholder ? "|" : "")}
              className="w-full px-5 py-4 bg-transparent outline-none resize-none text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-sm"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              style={{ minHeight: "56px", maxHeight: "120px" }}
            />
            <div className="absolute right-3 bottom-3">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="p-2.5 rounded-xl shadow-lg bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <Send size={18} className="text-white" />
              </motion.button>
            </div>
          </div>
          <p className="text-xs text-center text-slate-500 dark:text-slate-400 mt-3">
            <kbd className="px-2 py-1 bg-slate-200 dark:bg-slate-700 rounded text-xs">Enter</kbd> to send • 
            <kbd className="px-2 py-1 bg-slate-200 dark:bg-slate-700 rounded text-xs ml-1">Shift+Enter</kbd> for new line
          </p>
        </div>
      </motion.div>

      <style jsx>{`
        @keyframes blob {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-30px, 20px) scale(1.1); }
          66% { transform: translate(20px, -20px) scale(0.9); }
        }
        .animate-blob {
          animation: blob 8s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
      `}</style>
    </div>
  );
};

export default Chatbot;
