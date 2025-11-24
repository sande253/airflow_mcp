import React, { useState, useRef, useEffect } from "react";
import { Send, User } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const MCP_URL = "http://localhost:8800/run";
const TOOL_RERUN_URL = "http://localhost:8800/tool/rerun_dag"; // server provided endpoint

const Chatbot = () => {
  const [messages, setMessages] = useState([{ sender: "bot", text: "INPUT PLEASE" }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  // Placeholder typewriter
  const [placeholder, setPlaceholder] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const placeholderTexts = ["Ask me anything about Airflow..."];

  // DAG List pagination
  const [dagList, setDagList] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;
  const paginatedDags = dagList.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Auto-scroll to bottom on updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, dagList, currentPage]);

  // Typewriter placeholder effect
  useEffect(() => {
    const currentText = placeholderTexts[placeholderIndex];
    const speed = isDeleting ? 30 : 80;

    if (!isDeleting && placeholder === currentText) {
      const t = setTimeout(() => setIsDeleting(true), 2500);
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

  // Generic MCP server caller (POST /run)
  const callMCPServer = async (query) => {
    try {
      const res = await fetch(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, body: data };
    } catch (err) {
      console.error("MCP Server unreachable:", err);
      return { ok: false, status: 0, body: null, error: err.message || String(err) };
    }
  };

  // Groq model caller (unchanged logic, returns string)
  const callGroqModel = async (userMessage, airflowData) => {
    const apiKey = import.meta?.env?.VITE_GROQ_API_KEY || process.env?.REACT_APP_GROQ_API_KEY;
    if (!apiKey) return "Missing Groq API key. Add VITE_GROQ_API_KEY to .env";

    try {
      const res = await fetch(GROQ_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          temperature: 0.7,
          messages: [
            { role: "system", content: "You are a helpful Apache Airflow assistant." },
            { role: "user", content: `User: ${userMessage}\n\nAirflow Data: ${JSON.stringify(airflowData)}` },
          ],
        }),
      });

      const data = await res.json();
      return data.choices?.[0]?.message?.content || "Error: No response from model.";
    } catch (err) {
      return `Groq Error: ${err.message}`;
    }
  };

  // Extract DAG array from varied MCP shapes
  const extractDags = (mcpBody) => {
    if (!mcpBody) return [];
    // 1) /run returns { success: true, output: { dags: [...] } }
    if (mcpBody.output && Array.isArray(mcpBody.output.dags)) return mcpBody.output.dags;
    // 2) direct endpoints may return { success: true, dags: [...] } or { dags: [...] }
    if (Array.isArray(mcpBody.dags)) return mcpBody.dags;
    if (mcpBody.data) {
      // data might be the object with dags or an array of dags
      if (Array.isArray(mcpBody.data.dags)) return mcpBody.data.dags;
      if (Array.isArray(mcpBody.data)) return mcpBody.data;
    }
    // 3) search endpoints: { results: [...] }
    if (Array.isArray(mcpBody.results)) return mcpBody.results;
    // 4) fallback: maybe the body itself is an array (unlikely but handle)
    if (Array.isArray(mcpBody)) return mcpBody;
    // 5) no dags found
    return [];
  };

  // Utility: normalize DAG entries to simple strings (dag_id)
  const normalizeDagList = (rawDags) => {
    return rawDags.map((d) => {
      if (!d) return "";
      if (typeof d === "string") return d;
      return d.dag_id || d.dagId || d.id || JSON.stringify(d);
    }).filter(Boolean);
  };

  // Send message handler
  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMsg = { sender: "user", text: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    const query = input.trim();

    // RERUN DAG — try to detect "rerun <dag_id>" pattern
    const rerunMatch = query.toLowerCase().match(/\brerun\s+([a-zA-Z0-9_\-:.]+)/);
    if (rerunMatch) {
      const dagId = rerunMatch[1];
      try {
        const res = await fetch(TOOL_RERUN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dag_id: dagId }),
        });
        const body = await res.json().catch(() => ({}));
        console.log("RERUN RESPONSE:", res.status, body);

        if (res.ok && body?.success) {
          // server returns data inside body.data (call_airflow result)
          const runId = body.data?.dag_run_id || body.data?.run_id || body.data?.dagRunId || body.data?.dag_run?.dag_run_id;
          setMessages((prev) => [
            ...prev,
            {
              sender: "bot",
              text: `DAG \`${dagId}\` has been triggered successfully.\nRun ID: \`${runId || "manual"}\``,
            },
          ]);
        } else if (res.ok) {
          // success: false or unexpected payload
          setMessages((prev) => [
            ...prev,
            { sender: "bot", text: `Failed to trigger DAG \`${dagId}\`. Server responded with unexpected payload.` },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { sender: "bot", text: `Error: Failed to trigger DAG \`${dagId}\`. HTTP ${res.status}` },
          ]);
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          { sender: "bot", text: `Error: Could not reach MCP server. Is it running on port 8800? (${err.message || err})` },
        ]);
      } finally {
        setLoading(false);
      }
      return;
    }

    // LIST DAGS
    if (/\blist\b.*\bdag/i.test(query) || /show all dags/i.test(query)) {
      // use /run endpoint (server's natural language handler)
      const result = await callMCPServer("list all dags");
      console.log("MCP RESPONSE (list dags):", result);
      if (!result.ok) {
        setMessages((prev) => [...prev, { sender: "bot", text: "No DAGs found or server not responding." }]);
        setLoading(false);
        return;
      }

      const raw = result.body;
      const dags = extractDags(raw);
      if (dags.length > 0) {
        const normalized = normalizeDagList(dags);
        setDagList(normalized);
        setCurrentPage(1);
        setMessages((prev) => [...prev, { sender: "bot", text: `Found ${normalized.length} DAGs. Showing in table below.` }]);
      } else {
        setMessages((prev) => [...prev, { sender: "bot", text: "No DAGs found or server not responding." }]);
      }
      setLoading(false);
      return;
    }

    // DEFAULT: forward to MCP for structured airflow data, then to Groq model as fallback
    try {
      const mcpRes = await callMCPServer(query);
      console.log("MCP RESPONSE (default):", mcpRes);
      const airflowData = mcpRes.body;
      const reply = await callGroqModel(query, airflowData);
      setMessages((prev) => [...prev, { sender: "bot", text: reply || "No response from model." }]);
    } catch (err) {
      setMessages((prev) => [...prev, { sender: "bot", text: `Error processing request: ${err.message || err}` }]);
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

  // Smooth caret (keeps previous logic, defensive)
  useEffect(() => {
    const textarea = document.querySelector("textarea");
    const caret = document.getElementById("smooth-caret");
    if (!textarea || !caret) return;

    const updateCaret = () => {
      const text = textarea.value || " ";
      const measure = document.createElement("span");
      Object.assign(measure.style, {
        visibility: "hidden",
        position: "absolute",
        whiteSpace: "pre",
        font: window.getComputedStyle(textarea).font,
      });
      measure.textContent = text;
      document.body.appendChild(measure);
      const width = measure.clientWidth;
      document.body.removeChild(measure);
      caret.style.left = `${24 + width}px`;
    };

    updateCaret();
    textarea.addEventListener("input", updateCaret);
    return () => textarea.removeEventListener("input", updateCaret);
  }, [input]);

  return (
    <div className="relative h-screen flex flex-col bg-gradient-to-br from-slate-50 to-slate-200 dark:from-slate-900 dark:to-slate-800 overflow-hidden">
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-10 dark:opacity-5">
        <div className="absolute top-20 left-10 w-72 h-72 bg-slate-300 dark:bg-slate-700 rounded-full mix-blend-multiply filter blur-3xl animate-pulse-slow"></div>
        <div className="absolute top-40 right-10 w-72 h-72 bg-slate-300 dark:bg-slate-700 rounded-full mix-blend-multiply filter blur-3xl animate-pulse-slow delay-2000"></div>
        <div className="absolute -bottom-20 left-1/2 w-72 h-72 bg-slate-300 dark:bg-slate-700 rounded-full mix-blend-multiply filter blur-3xl animate-pulse-slow delay-4000"></div>
      </div>

      <div className="h-8 md:h-20" />

      {/* Chat messages */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 md:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="pt-6 space-y-6">
            <AnimatePresence mode="wait">
              {messages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.35 }}
                  className={`flex gap-4 ${msg.sender === "user" ? "flex-row-reverse" : "flex-r ow"}`}
                >
                  <div className="flex-shrink-0">
                    {msg.sender === "bot" ? (
                      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800 shadow-lg flex items-center justify-center">
                        <div className="w-9 h-9 rounded-lg bg-white dark:bg-slate-900 flex items-center justify-center text-lg font-bold text-slate-700 dark:text-slate-300">
                          AI
                        </div>
                      </div>
                    ) : (
                      <div className="w-11 h-11 rounded-xl bg-slate-600 dark:bg-slate-500 flex items-center justify-center shadow-lg">
                        <User className="text-white" size={20} />
                      </div>
                    )}
                  </div>

                  <div
                    className={`px-5 py-3.5 rounded-2xl shadow-lg backdrop-blur-md max-w-2xl ${
                      msg.sender === "user"
                        ? "bg-slate-700 text-white font-medium rounded-tr-none"
                        : "bg-white/95 dark:bg-slate-800/95 text-slate-800 dark:text-slate-100 border border-slate-200/50 dark:border-slate-700/50 rounded-tl-none"
                    }`}
                  >
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  </div>
                </motion.div>
              ))}

              {/* Thinking animation */}
              {loading && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex gap-4">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800 shadow-lg flex items-center justify-center">
                    <div className="w-9 h-9 rounded-lg bg-white dark:bg-slate-900 flex items-center justify-center text-lg font-bold text-slate-700 dark:text-slate-300">
                      AI
                    </div>
                  </div>

                  <div className="bg-white/95 dark:bg-slate-800/95 border border-slate-200/50 dark:border-slate-700/50 rounded-2xl rounded-tl-none px-5 py-3.5 shadow-lg backdrop-blur-md flex items-center gap-3">
                    <div className="flex space-x-1.5">
                      {[0, 0.15, 0.3].map((delay) => (
                        <motion.div
                          key={delay}
                          className="w-2 h-2 bg-slate-500 rounded-full"
                          animate={{ y: [0, -8, 0] }}
                          transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut", delay }}
                        />
                      ))}
                    </div>
                    <span className="text-sm text-slate-500 dark:text-slate-400 font-medium">Thinking...</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* DAG List Table */}
            {dagList.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 p-6 rounded-2xl shadow-2xl bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border border-slate-300/40 dark:border-slate-700/40"
              >
                <h2 className="text-xl font-semibold mb-4 text-slate-800 dark:text-slate-100">
                  DAG List — Page {currentPage} of {Math.ceil(dagList.length / PAGE_SIZE) || 1}
                </h2>
                <div className="overflow-x-auto rounded-xl border border-slate-200/50 dark:border-slate-700/50">
                  <table className="min-w-full text-left text-slate-800 dark:text-slate-200">
                    <thead className="bg-slate-600 text-white">
                      <tr>
                        <th className="px-4 py-3">#</th>
                        <th className="px-4 py-3">DAG ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedDags.map((dag, idx) => (
                        <tr
                          key={idx}
                          className="border-b border-slate-200/50 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition"
                        >
                          <td className="px-4 py-3">{(currentPage - 1) * PAGE_SIZE + idx + 1}</td>
                          <td className="px-4 py-3 font-medium">{dag}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-between mt-4">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                    className="px-4 py-2 rounded-xl font-medium shadow bg-slate-300 dark:bg-slate-700 disabled:opacity-40 hover:bg-slate-400 dark:hover:bg-slate-600 transition"
                  >
                    Previous
                  </button>
                  <button
                    disabled={currentPage >= Math.ceil(dagList.length / PAGE_SIZE)}
                    onClick={() => setCurrentPage((p) => p + 1)}
                    className="px-4 py-2 rounded-xl font-medium shadow bg-slate-600 text-white disabled:opacity-40 hover:bg-slate-700 transition"
                  >
                    Next
                  </button>
                </div>
              </motion.div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>
      </div>

      {/* Input bar */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 40 }}
        className="relative z-10 px-4 pb-8 md:px-8"
      >
        <div className="max-w-4xl mx-auto">
          <div className="relative group">
            <div className="relative bg-white/90 dark:bg-slate-800/95 backdrop-blur-2xl rounded-2xl shadow-2xl border border-slate-200/60 dark:border-slate-700/60 overflow-hidden transition-all duration-300 ring-0 focus-within:ring-4 focus-within:ring-slate-400/20 hover:shadow-3xl">
              <textarea
                placeholder={placeholder + "|"}
                className="w-full px-6 py-5 bg-transparent outline-none resize-none text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-base leading-relaxed"
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                style={{ minHeight: "64px", maxHeight: "140px" }}
                spellCheck={false}
              />
              <div
                id="smooth-caret"
                className="absolute w-0.5 h-6 bg-slate-600 dark:bg-slate-400 top-6 left-6 pointer-events-none"
                style={{ transition: "left 70ms cubic-bezier(0.25, 0.1, 0.3, 1)" }}
              />
              <div className="absolute right-4 bottom-4">
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={sendMessage}
                  disabled={loading || !input.trim()}
                  className="p-2.5 rounded-full shadow-lg bg-slate-600 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  <Send size={22} className="text-white" />
                </motion.button>
              </div>
            </div>
          </div>
          <p className="text-xs text-center text-slate-400 dark:text-slate-300 mt-4 font-medium tracking-wider">
            Press{" "}
            <kbd className="mx-1 px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg font-mono shadow-inner">Enter</kbd>{" "}
            to send •{" "}
            <kbd className="mx-1 px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg font-mono shadow-inner">Shift + Enter</kbd>{" "}
            for new line
          </p>
        </div>
      </motion.div>

      <style jsx>{`
        @keyframes pulse-slow {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.3; }
          50% { transform: translate(10px, -10px) scale(1.05); opacity: 0.6; }
        }
        .animate-pulse-slow { animation: pulse-slow 8s infinite; }
        .delay-2000 { animation-delay: 2s; }
        .delay-4000 { animation-delay: 4s; }
      `}</style>
    </div>
  );
};

export default Chatbot;

