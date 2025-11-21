// src/pages/Analytics.jsx
import React, { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  HiCheckCircle,
  HiClock,
  HiChevronLeft,
  HiChevronRight,
  HiSearch,
} from "react-icons/hi";
import { SiApacheairflow } from "react-icons/si";

const MCP_URL = "http://localhost:8800/run";

const AnalyticsDashboard = () => {
  const [dagData, setDagData] = useState([]);
  const [loading, setLoading] = useState(true);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(100);

  // Filters (compact)
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("");

  // -----------------------------------------------------------
  // Fetch DAGs
  // -----------------------------------------------------------
  useEffect(() => {
    fetchDagData();
  }, []);

  const fetchDagData = async () => {
    setLoading(true);
    try {
      const res = await fetch(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "list dags" }),
      });
      const data = await res.json();

      const dags = data.output?.dags || [];
      setDagData(dags);
    } catch (err) {
      console.error("Fetch error", err);
    } finally {
      setLoading(false);
    }
  };

  // -----------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------
  const allTags = useMemo(() => {
    const set = new Set();
    dagData.forEach((d) => d.tags?.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [dagData]);

  const filteredData = useMemo(() => {
    return dagData.filter((dag) => {
      if (searchTerm && !dag.dag_id.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (statusFilter === "running" && dag.is_paused) return false;
      if (statusFilter === "paused" && !dag.is_paused) return false;
      if (activeFilter === "active" && !dag.is_active) return false;
      if (activeFilter === "inactive" && dag.is_active) return false;
      if (tagFilter && (!dag.tags || !dag.tags.includes(tagFilter))) return false;
      return true;
    });
  }, [dagData, searchTerm, statusFilter, activeFilter, tagFilter]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const paginatedData = filteredData.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // -----------------------------------------------------------
  // Stat Card Component (restored)
  // -----------------------------------------------------------
  const StatCard = ({ title, value, icon: Icon, gradient }) => (
    <motion.div
      whileHover={{ y: -4 }}
      className="relative overflow-hidden rounded-2xl bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 p-6 shadow-xl"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
        </div>
        <div className={`p-4 rounded-xl bg-gradient-to-br ${gradient}`}>
          <Icon className="text-2xl text-white" />
        </div>
      </div>
    </motion.div>
  );

  // -----------------------------------------------------------
  // MAIN UI
  // -----------------------------------------------------------
  return (
    <div className="h-screen overflow-hidden flex flex-col pt-24 px-8 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-gray-900 dark:to-slate-900">

      {/* ----------------------------------------------------- */}
      {/* Stats Row */}
      {/* ----------------------------------------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard
          title="Total DAGs"
          value={dagData.length}
          icon={SiApacheairflow}
          gradient="from-blue-500 to-cyan-600"
        />
        <StatCard
          title="Active"
          value={dagData.filter((d) => d.is_active && !d.is_paused).length}
          icon={HiCheckCircle}
          gradient="from-green-500 to-emerald-600"
        />
        <StatCard
          title="Paused"
          value={dagData.filter((d) => d.is_paused).length}
          icon={HiClock}
          gradient="from-amber-500 to-orange-600"
        />
      </div>

      {/* ----------------------------------------------------- */}
      {/* TABLE CARD */}
      {/* ----------------------------------------------------- */}
      <div className="flex-1 min-h-0 bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden flex flex-col">

        {/* --------------------------------------------------- */}
        {/* FIXED TABLE HEADER with Filters */}
        {/* --------------------------------------------------- */}
       <div className="sticky top-0 z-30 bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 shadow-lg">
          <table className="w-full">
            <thead>
              {/* Column Headers Row */}
              <tr className="border-b border-white/10">
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  #
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  DAG Identifier
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Active
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Tags
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Description
                </th>
              </tr>
              
              {/* Filters Row */}
              <tr className="bg-slate-900/50">
                <th className="px-6 py-3"></th>
                
                <th className="px-6 py-3">
                  <div className="relative">
                    <HiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
                    <input
                      type="text"
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-400 focus:bg-white/15 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                      placeholder="Search DAG ID..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </th>

                <th className="px-6 py-3">
                  <select
                    className="w-full px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-lg text-white focus:bg-white/15 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all cursor-pointer"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all" className="bg-slate-800">All Status</option>
                    <option value="running" className="bg-slate-800">Running</option>
                    <option value="paused" className="bg-slate-800">Paused</option>
                  </select>
                </th>

                <th className="px-6 py-3">
                  <select
                    className="w-full px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-lg text-white focus:bg-white/15 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all cursor-pointer"
                    value={activeFilter}
                    onChange={(e) => setActiveFilter(e.target.value)}
                  >
                    <option value="all" className="bg-slate-800">All</option>
                    <option value="active" className="bg-slate-800">Active Only</option>
                    <option value="inactive" className="bg-slate-800">Inactive Only</option>
                  </select>
                </th>

                <th className="px-6 py-3">
                  <select
                    className="w-full px-3 py-2 text-sm bg-white/10 border border-white/20 rounded-lg text-white focus:bg-white/15 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all cursor-pointer"
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value)}
                  >
                    <option value="" className="bg-slate-800">All Tags</option>
                    {allTags.map((t) => (
                      <option key={t} className="bg-slate-800">{t}</option>
                    ))}
                  </select>
                </th>

                <th className="px-6 py-3"></th>
              </tr>
            </thead>
          </table>
        </div>

        {/* --------------------------------------------------- */}
        {/* TABLE BODY (scrolls independently) */}
        {/* --------------------------------------------------- */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : paginatedData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-500">
                    No DAGs found
                  </td>
                </tr>
              ) : (
                paginatedData.map((dag, i) => (
                  <tr key={dag.dag_id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    <td className="px-6 py-4 text-gray-500">
                      {(currentPage - 1) * itemsPerPage + i + 1}
                    </td>

                    <td className="px-6 py-4 font-mono">{dag.dag_id}</td>

                    <td className="px-6 py-4">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold ${
                          dag.is_paused
                            ? "bg-amber-100 text-amber-700"
                            : "bg-green-100 text-green-700"
                        }`}
                      >
                        {dag.is_paused ? "PAUSED" : "RUNNING"}
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold ${
                          dag.is_active
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {dag.is_active ? "YES" : "NO"}
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {dag.tags?.length ? (
                          dag.tags.map((t) => (
                            <span
                              key={t}
                              className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded"
                            >
                              {t}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </div>
                    </td>

                    <td className="px-6 py-4 text-gray-600 truncate max-w-md">
                      {dag.description || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* --------------------------------------------------- */}
        {/* PAGINATION (Styled, Fixed Bottom) */}
        {/* --------------------------------------------------- */}
        <div className="p-4 border-t border-gray-200/50 dark:border-gray-700/50 bg-white/50 dark:bg-gray-800/50 flex justify-between items-center text-sm">

          <span className="text-gray-600">
            Showing {(currentPage - 1) * itemsPerPage + 1}–
            {Math.min(currentPage * itemsPerPage, filteredData.length)} of{" "}
            {filteredData.length}
          </span>

          <div className="flex items-center gap-1">
            {/* Prev */}
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 border rounded disabled:opacity-40"
            >
              <HiChevronLeft />
            </button>

            {/* Page numbers */}
            {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => setCurrentPage(n)}
                className={`px-3 py-1 rounded ${
                  currentPage === n
                    ? "bg-blue-600 text-white"
                    : "border hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
              >
                {n}
              </button>
            ))}

            {/* Ellipsis */}
            {totalPages > 10 && <span className="px-2">...</span>}

            {/* Next */}
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 border rounded disabled:opacity-40"
            >
              <HiChevronRight />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default AnalyticsDashboard;
