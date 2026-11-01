"use client";

import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  FolderPlus,
  Layers,
  Play,
  Plus,
  RefreshCw,
  Search,
  ChevronRight,
  MoreHorizontal,
  X,
  Trash2,
  Webhook,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { FeatureDialog } from "@/features/knowledge/components/feature-dialog";
import { LeadSelect } from "./lead-select";
import { useCallback, useEffect, useState } from "react";
import {
  createCollection,
  createConnector,
  deleteCollection,
  listCollections,
  listConnectors,
  listWorkspaceBatches,
  revokeConnector,
  rotateConnectorToken,
  suggestFieldMapping,
  testFieldMapping,
} from "../lib/client";
import type {
  InboundBatchEvent,
  InboundConnector,
  LeadCollection,
  QualificationMode,
} from "../lib/types";

interface ConnectorsPageProps {
  workspaceId: string;
}

export function LeadGenerationConnectorsPage({ workspaceId }: ConnectorsPageProps) {
  const [activeTab, setActiveTab] = useState<"connectors" | "collections" | "batches" | "guide">(
    "connectors",
  );
  const [connectors, setConnectors] = useState<InboundConnector[]>([]);
  const [collections, setCollections] = useState<LeadCollection[]>([]);
  const [batches, setBatches] = useState<InboundBatchEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [connectorStep, setConnectorStep] = useState(0);
  const [selectedConnector, setSelectedConnector] = useState<InboundConnector | null>(null);
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New Connector Modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newConnName, setNewConnName] = useState("");
  const [newConnSourceType, setNewConnSourceType] = useState("generic_json");
  const [newConnCollectionId, setNewConnCollectionId] = useState("");
  const [newConnMode, setNewConnMode] = useState<QualificationMode>("strict");
  const [newConnBatchLimit, setNewConnBatchLimit] = useState(100);
  const [submittingConn, setSubmittingConn] = useState(false);

  // Revealed Token Modal
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [revealedConnectorId, setRevealedConnectorId] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  // New Collection Modal state
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [newCollName, setNewCollName] = useState("");
  const [newCollDesc, setNewCollDesc] = useState("");
  const [newCollMode, setNewCollMode] = useState<QualificationMode>("strict");
  const [newCollContact, setNewCollContact] = useState<
    "none" | "email" | "phone" | "either" | "both"
  >("none");
  const [submittingColl, setSubmittingColl] = useState(false);

  // Field Mapping Test Bench state
  const [testSample, setTestSample] = useState(
    JSON.stringify(
      {
        company: "Apex Luxury Jewels",
        website: "https://apexluxury.example.com",
        contact_name: "Elena Rostova",
        title: "Head of Procurement",
        email: "elena@apexluxury.example.com",
        phone: "+1-415-555-0199",
        industry: "Luxury Retail & Jewelry",
        city: "San Francisco, CA",
        employees: "50-100",
      },
      null,
      2,
    ),
  );
  const [mappingEntries, setMappingEntries] = useState<Array<{ source: string; target: string }>>([
    { source: "company", target: "company_name" },
    { source: "contact_name", target: "person_name" },
    { source: "title", target: "person_role" },
  ]);
  const [testResult, setTestResult] = useState<{
    transformed: Record<string, unknown>;
    missing_fields: string[];
  } | null>(null);
  const [testingMapping, setTestingMapping] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, collRes, bRes] = await Promise.all([
        listConnectors(workspaceId),
        listCollections(workspaceId),
        listWorkspaceBatches(workspaceId),
      ]);
      if (cRes.data) setConnectors(cRes.data.items);
      if (collRes.data) setCollections(collRes.data.items);
      if (bRes.data) setBatches(bRes.data.items);
      setError(cRes.error?.message || collRes.error?.message || bRes.error?.message || null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load connectors");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    function closeMenus(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      document
        .querySelectorAll<HTMLDetailsElement>(".lead-connectors-redesign .connector-menu[open]")
        .forEach((menu) => {
          if (
            event instanceof PointerEvent &&
            event.target instanceof Node &&
            menu.contains(event.target)
          )
            return;
          menu.open = false;
          if (event instanceof KeyboardEvent) menu.querySelector<HTMLElement>("summary")?.focus();
        });
    }
    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", closeMenus);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("keydown", closeMenus);
    };
  }, []);

  async function handleCreateConnector(e: React.FormEvent) {
    e.preventDefault();
    if (!newConnName.trim()) {
      setConnectorStep(0);
      setDialogError("Enter a connector name.");
      return;
    }
    if (submittingConn) return;
    setDialogError(null);
    if (!Number.isInteger(newConnBatchLimit) || newConnBatchLimit < 1 || newConnBatchLimit > 500) {
      setConnectorStep(0);
      setDialogError("Batch size must be between 1 and 500.");
      return;
    }
    setSubmittingConn(true);
    setError(null);

    const mappingObj: Record<string, string> = {};
    for (const m of mappingEntries) {
      if (m.source.trim() && m.target.trim()) {
        mappingObj[m.source.trim()] = m.target.trim();
      }
    }

    const res = await createConnector(workspaceId, {
      name: newConnName.trim(),
      source_type: newConnSourceType,
      collection_id: newConnCollectionId || undefined,
      default_qualification_mode: newConnMode,
      batch_size_limit: newConnBatchLimit,
      field_mapping: Object.keys(mappingObj).length > 0 ? mappingObj : undefined,
    });

    setSubmittingConn(false);
    if (res.data) {
      setRevealedToken(res.data.secret_token);
      setRevealedConnectorId(res.data.connector.id);
      setCreateModalOpen(false);
      setNewConnName("");
      void loadData();
    } else {
      setDialogError(res.error?.message || "Failed to create connector");
    }
  }

  async function handleRotateToken(connectorId: string) {
    if (!confirm("Rotating the token will invalidate the old credential immediately. Continue?"))
      return;
    const res = await rotateConnectorToken(workspaceId, connectorId);
    if (res.data) {
      setRevealedToken(res.data.secret_token);
      setRevealedConnectorId(res.data.connector.id);
      void loadData();
    } else {
      alert(res.error?.message || "Failed to rotate token");
    }
  }

  async function handleRevokeConnector(connectorId: string) {
    if (
      !confirm(
        "Are you sure you want to revoke this connector? All incoming push requests will be rejected.",
      )
    )
      return;
    const res = await revokeConnector(workspaceId, connectorId);
    if (res.data) {
      void loadData();
    } else {
      alert(res.error?.message || "Failed to revoke connector");
    }
  }

  async function handleCreateCollection(e: React.FormEvent) {
    e.preventDefault();
    if (!newCollName.trim() || submittingColl) return;
    setDialogError(null);
    setSubmittingColl(true);
    const res = await createCollection(workspaceId, {
      name: newCollName.trim(),
      description: newCollDesc.trim() || undefined,
      qualification_overrides: {
        qualification_mode: newCollMode,
        required_contact: newCollContact,
      },
    });
    setSubmittingColl(false);
    if (res.data) {
      setCollectionModalOpen(false);
      setNewCollName("");
      setNewCollDesc("");
      void loadData();
    } else {
      setDialogError(res.error?.message || "Failed to create collection");
    }
  }

  async function handleDeleteCollection(collectionId: string) {
    if (!confirm("Are you sure you want to delete this collection?")) return;
    const res = await deleteCollection(workspaceId, collectionId);
    if (res.data) {
      void loadData();
    } else {
      alert(res.error?.message || "Failed to delete collection");
    }
  }

  async function handleSuggestMapping() {
    try {
      const parsed = JSON.parse(testSample);
      const res = await suggestFieldMapping(workspaceId, { sample_payload: parsed });
      if (res.data?.suggested_mapping) {
        const entries = Object.entries(res.data.suggested_mapping).map(([source, target]) => ({
          source,
          target,
        }));
        setMappingEntries(entries);
        setTestResult(null);
      } else {
        setDialogError(res.error?.message || "Could not suggest field mappings.");
      }
    } catch {
      setDialogError("Please enter a valid JSON sample.");
    }
  }

  async function handleTestMapping() {
    setTestingMapping(true);
    setDialogError(null);
    setTestResult(null);
    try {
      const parsed = JSON.parse(testSample);
      const mappingObj: Record<string, string> = {};
      for (const m of mappingEntries) {
        if (m.source.trim() && m.target.trim()) {
          mappingObj[m.source.trim()] = m.target.trim();
        }
      }
      const res = await testFieldMapping(workspaceId, {
        sample_payload: parsed,
        mapping: mappingObj,
      });
      if (res.data) {
        setTestResult(res.data);
      } else {
        setDialogError(res.error?.message || "Test failed");
      }
    } catch (err: unknown) {
      setDialogError(err instanceof Error ? err.message : "Could not test sample JSON.");
    } finally {
      setTestingMapping(false);
    }
  }

  async function copyToken(text: string, endpointId?: string) {
    try {
      await navigator.clipboard.writeText(text);
      if (endpointId) {
        setCopiedEndpoint(endpointId);
        setTimeout(() => setCopiedEndpoint(null), 2000);
      } else {
        setTokenCopied(true);
        setTimeout(() => setTokenCopied(false), 2000);
      }
    } catch {
      setError("Copy failed. Select the value and copy it manually.");
    }
  }

  useEffect(() => {
    setTestResult(null);
  }, [testSample, mappingEntries]);

  const originUrl =
    typeof window !== "undefined" ? window.location.origin : "https://app.quickstartai.com";

  const visibleConnectors = connectors.filter(
    (c) =>
      (status === "all" || c.status === status) &&
      `${c.name} ${c.source_type} ${collections.find((col) => col.id === c.collection_id)?.name || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const modeOptions = [
    { value: "strict" as const, label: "Strict match" },
    { value: "best_match" as const, label: "Best match" },
  ];
  const sourceOptions = [
    { value: "generic_json", label: "Generic JSON" },
    { value: "apify", label: "Apify Actor" },
    { value: "crawler", label: "Custom crawler" },
    { value: "webhook", label: "External webhook" },
  ];
  const targetOptions = [
    "company_name",
    "website",
    "person_name",
    "person_role",
    "email",
    "phone",
    "industry",
    "location",
    "company_size",
    "external_id",
  ].map((value) => ({ value, label: value.replaceAll("_", " ") }));
  const contactOptions = [
    { value: "none" as const, label: "No requirement" },
    { value: "email" as const, label: "Email address" },
    { value: "phone" as const, label: "Phone number" },
    { value: "either" as const, label: "Either email or phone" },
    { value: "both" as const, label: "Both email and phone" },
  ];
  const collectionOptions = [
    { value: "", label: "General workspace" },
    ...collections.map((c) => ({ value: c.id, label: c.name })),
  ];
  const openConnector = () => {
    setConnectorStep(0);
    setDialogError(null);
    setCreateModalOpen(true);
  };
  const openCollection = () => {
    setDialogError(null);
    setCollectionModalOpen(true);
  };

  return (
    <div className="lead-console lead-connectors-redesign settings-page">
      <header className="settings-heading">
        <div className="settings-title">
          <Link
            className="settings-back"
            href={`/workspaces/${workspaceId}/lead-generation/runs`}
            title="Back to runs"
            aria-label="Back to runs"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1>Inbound connectors</h1>
            <p>Bring leads from your tools into one workspace.</p>
          </div>
        </div>
        <div className="settings-actions">
          <button type="button" className="settings-button" onClick={openCollection}>
            <FolderPlus size={17} />
            New collection
          </button>
          <button type="button" className="settings-button primary" onClick={openConnector}>
            <Plus size={17} />
            Create connector
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className="settings-message error">
          <AlertCircle size={18} />
          {error}
        </p>
      )}
      <div className="settings-stats">
        <span>
          <strong>{connectors.length}</strong> connectors
        </span>
        <span>
          <strong>{collections.length}</strong> collections
        </span>
        <span>
          <strong>{batches.length}</strong> imports
        </span>
      </div>
      <nav className="settings-tabs" aria-label="Inbound sections">
        {(
          [
            { id: "connectors", label: "Connectors", count: connectors.length },
            { id: "collections", label: "Collections", count: collections.length },
            { id: "batches", label: "Import history", count: batches.length },
            { id: "guide", label: "Setup guide" },
          ] as const
        ).map((tab) => (
          <button
            type="button"
            key={tab.id}
            aria-current={activeTab === tab.id ? "page" : undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {"count" in tab && <span>{tab.count}</span>}
          </button>
        ))}
      </nav>
      {loading && (
        <p role="status" className="settings-message">
          Loading connectors…
        </p>
      )}
      {activeTab === "connectors" && (
        <section className="connector-list">
          <div className="settings-toolbar">
            <div className="settings-search">
              <Search size={17} />
              <input
                aria-label="Search connectors"
                placeholder="Search connectors…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <LeadSelect
              label="Connector status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "All statuses" },
                { value: "active", label: "Active" },
                { value: "revoked", label: "Revoked" },
              ]}
            />
            <button
              type="button"
              className="settings-button refresh"
              aria-label="Refresh connectors"
              onClick={() => void loadData()}
              disabled={loading}
            >
              <RefreshCw size={17} />
            </button>
          </div>
          <div className="connector-table">
            <table>
              <thead>
                <tr>
                  <th>Connector</th>
                  <th>Destination</th>
                  <th>Endpoint</th>
                  <th>Last activity</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleConnectors.map((c) => {
                  const endpoint = `${originUrl}/api/v1/inbound/ingest/${c.id}`;
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className="connector-name">
                          <span className="settings-icon">
                            <Webhook size={19} />
                          </span>
                          <div>
                            <button
                              type="button"
                              className="connector-name-button"
                              onClick={() => setSelectedConnector(c)}
                            >
                              {c.name}
                            </button>
                            <p>
                              {sourceOptions.find((o) => o.value === c.source_type)?.label ||
                                c.source_type}{" "}
                              <span
                                className={
                                  c.status === "active"
                                    ? "connector-status active"
                                    : "connector-status"
                                }
                              >
                                • {c.status}
                              </span>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong>
                          {collections.find((col) => col.id === c.collection_id)?.name ||
                            "General workspace"}
                        </strong>
                        <p>
                          {c.default_qualification_mode === "best_match"
                            ? "Best match"
                            : "Strict match"}
                        </p>
                      </td>
                      <td>
                        <div className="connector-endpoint">
                          <span title={endpoint}>…/ingest/{c.id.slice(0, 8)}</span>
                          <button
                            type="button"
                            aria-label={`Copy endpoint for ${c.name}`}
                            onClick={() => void copyToken(endpoint, c.id)}
                          >
                            {copiedEndpoint === c.id ? <Check size={16} /> : <Copy size={16} />}
                          </button>
                        </div>
                      </td>
                      <td>
                        {c.last_used_at ? (
                          <>
                            <span>{new Date(c.last_used_at).toLocaleDateString()}</span>
                            <p>
                              {new Date(c.last_used_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </>
                        ) : (
                          "No imports yet"
                        )}
                      </td>
                      <td>
                        <div className="connector-row-actions">
                          <button
                            type="button"
                            aria-label={`Details for ${c.name}`}
                            onClick={() => setSelectedConnector(c)}
                          >
                            <ChevronRight size={18} />
                          </button>
                          <details className="connector-menu">
                            <summary aria-label={`Actions for ${c.name}`}>
                              <MoreHorizontal size={20} />
                            </summary>
                            <div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.currentTarget.closest("details")?.removeAttribute("open");
                                  void copyToken(endpoint, c.id);
                                }}
                              >
                                Copy endpoint
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.currentTarget.closest("details")?.removeAttribute("open");
                                  void handleRotateToken(c.id);
                                }}
                              >
                                Rotate token
                              </button>
                              {c.status === "active" && (
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={(e) => {
                                    e.currentTarget.closest("details")?.removeAttribute("open");
                                    void handleRevokeConnector(c.id);
                                  }}
                                >
                                  Revoke connector
                                </button>
                              )}
                            </div>
                          </details>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && visibleConnectors.length === 0 && (
              <div className="settings-empty">
                <Webhook size={26} />
                <h3>
                  {connectors.length ? "No matching connectors" : "Connect your first source"}
                </h3>
                <p>
                  {connectors.length
                    ? "Try another search or status."
                    : "Create an endpoint to receive leads from Apify or your own tools."}
                </p>
                {!connectors.length && (
                  <button type="button" className="settings-button primary" onClick={openConnector}>
                    Create connector
                  </button>
                )}
              </div>
            )}
          </div>
          <footer className="connector-list-footer">
            <span>{visibleConnectors.length} connectors</span>
            <button type="button" onClick={() => setActiveTab("guide")}>
              Open setup guide →
            </button>
          </footer>
        </section>
      )}
      {activeTab === "collections" && (
        <div className="space-y-4">
          {collections.length === 0 && !loading ? (
            <div className="rounded-12 border border-dashed border-neutral-300 p-12 text-center bg-white space-y-3">
              <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mx-auto text-neutral-400">
                <Layers className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-neutral-900">No collections defined</h3>
              <p className="text-xs text-neutral-500 max-w-md mx-auto">
                Collections group related inbound batches and can enforce specific qualification
                mode and contact requirement overrides.
              </p>
              <button
                type="button"
                onClick={() => setCollectionModalOpen(true)}
                className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-8 text-xs font-semibold bg-heat-100 text-white hover:bg-orange-600 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Create collection</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {collections.map((col) => (
                <div
                  key={col.id}
                  className="border border-neutral-200 rounded-10 bg-white p-4 space-y-3 shadow-xs"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-bold text-neutral-900 text-sm">{col.name}</h4>
                      <p className="text-xs text-neutral-500 mt-0.5 line-clamp-2">
                        {col.description || "No description provided."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteCollection(col.id)}
                      className="text-neutral-400 hover:text-red-600 p-1 rounded hover:bg-neutral-100 transition-colors"
                      title="Delete collection"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="border-t border-neutral-100 pt-3 space-y-1.5 text-xs">
                    <div className="flex justify-between text-neutral-600">
                      <span>Mode Override:</span>
                      <span className="font-semibold capitalize text-neutral-900">
                        {col.qualification_overrides?.qualification_mode || "Inherit connector"}
                      </span>
                    </div>
                    <div className="flex justify-between text-neutral-600">
                      <span>Required Contact:</span>
                      <span className="font-semibold capitalize text-neutral-900">
                        {col.qualification_overrides?.required_contact || "none"}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 text-[10px] font-mono text-neutral-400 border-t border-neutral-100">
                    ID: {col.id}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: BATCHES */}
      {activeTab === "batches" && (
        <div className="space-y-4">
          {batches.length === 0 ? (
            <div className="rounded-12 border border-dashed border-neutral-300 p-12 text-center bg-white space-y-2">
              <p className="text-xs text-neutral-500">No inbound batches received yet.</p>
            </div>
          ) : (
            <div className="border border-neutral-200 rounded-10 bg-white overflow-hidden shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold">
                  <tr>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Batch ID</th>
                    <th className="py-3 px-4">Connector</th>
                    <th className="py-3 px-4">Records</th>
                    <th className="py-3 px-4">Created / Updated</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {batches.map((b) => {
                    const conn = connectors.find((c) => c.id === b.connector_id);
                    return (
                      <tr key={b.id} className="hover:bg-neutral-50/70">
                        <td className="py-3 px-4 text-neutral-600 whitespace-nowrap">
                          {new Date(b.created_at).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-neutral-500">
                          {b.id.slice(0, 8)}…
                        </td>
                        <td className="py-3 px-4 font-medium text-neutral-900">
                          {conn?.name || b.connector_id.slice(0, 8)}
                        </td>
                        <td className="py-3 px-4 font-semibold text-neutral-800">
                          {b.records_count}
                        </td>
                        <td className="py-3 px-4 text-neutral-600">
                          <span className="text-emerald-700 font-semibold">
                            {b.created_count} created
                          </span>
                          <span className="text-neutral-400 mx-1">/</span>
                          <span className="text-neutral-700 font-semibold">
                            {b.updated_count} updated
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              b.status === "completed"
                                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                : b.status === "partial_failure"
                                  ? "bg-amber-50 text-amber-800 border border-amber-200"
                                  : "bg-red-50 text-red-800 border border-red-200"
                            }`}
                          >
                            {b.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-neutral-500">
                          {b.failed_count > 0 ? (
                            <span className="text-red-600 font-medium">
                              {b.failed_count} failed
                            </span>
                          ) : (
                            <span className="text-emerald-600">None</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: APIFY & INTEGRATION GUIDE */}
      {activeTab === "guide" && (
        <div className="space-y-6 bg-white border border-neutral-200 rounded-12 p-6">
          <div className="space-y-2">
            <h3 className="text-base font-bold text-neutral-900 flex items-center gap-2">
              <Zap className="w-5 h-5 text-heat-100" />
              <span>External Inbound Lead Push Architecture</span>
            </h3>
            <p className="text-xs text-neutral-600 leading-relaxed max-w-3xl">
              External tools run independently and <strong>PUSH</strong> results into QuickStart AI
              via our HTTP ingestion endpoint. The portal does not initiate or control external
              scraper jobs.
            </p>
          </div>

          <div className="border border-neutral-200 rounded-10 p-4 bg-neutral-50 space-y-3">
            <h4 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
              Example cURL Ingestion
            </h4>
            <pre className="bg-neutral-900 text-neutral-100 p-4 rounded-8 text-xs font-mono overflow-x-auto leading-relaxed">
              {`curl -X POST "${originUrl}/api/v1/inbound/ingest/<YOUR_CONNECTOR_ID>" \\
  -H "Authorization: Bearer inb_live_..." \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: batch-2026-10-25-01" \\
  -d '{
    "records": [
      {
        "company": "Apex Luxury Jewels",
        "website": "https://apexluxury.example.com",
        "contact_name": "Elena Rostova",
        "title": "Head of Procurement",
        "email": "elena@apexluxury.example.com",
        "phone": "+1-415-555-0199",
        "industry": "Luxury Retail",
        "city": "San Francisco, CA"
      }
    ]
  }'`}
            </pre>
          </div>

          <div className="space-y-3 text-xs text-neutral-700 leading-relaxed">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h4 className="font-bold text-neutral-900 text-sm">
                Apify Actor Integration Options
              </h4>
              <Link
                href={`/workspaces/${workspaceId}/integrations`}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-6 bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 font-semibold text-xs transition-colors self-start sm:self-auto"
              >
                <span>Connect Apify Account via Integrations</span>
                <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-neutral-200 rounded-8 p-4 bg-white space-y-2">
                <span className="font-bold text-neutral-900 block">
                  Option A: Direct Inbound Webhook
                </span>
                <p className="text-neutral-600">
                  Configure an Apify Actor with a webhook that POSTs the dataset or item output
                  directly to the Ingestion URL with the{" "}
                  <code className="bg-neutral-100 px-1 py-0.5 rounded">
                    Authorization: Bearer inb_live_...
                  </code>{" "}
                  header.
                </p>
              </div>
              <div className="border border-neutral-200 rounded-8 p-4 bg-white space-y-2">
                <span className="font-bold text-neutral-900 block">
                  Option B: External Adapter / Zapier / Make
                </span>
                <p className="text-neutral-600">
                  When an Apify Actor finishes and sends a run notification webhook containing a
                  dataset ID, use an automation step or external script to fetch the dataset and
                  POST normalized JSON records to our endpoint.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <FeatureDialog
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create connector"
        description="Connect a source, then map its lead data."
        layout="lead-wizard"
        isSubmitting={submittingConn}
      >
        <form
          className="settings-connector-wizard"
          onSubmit={(e) => {
            if (connectorStep === 0) {
              e.preventDefault();
              if (newConnName.trim()) {
                setConnectorStep(1);
                setDialogError(null);
              } else setDialogError("Enter a connector name.");
            } else void handleCreateConnector(e);
          }}
        >
          <nav className="settings-rail" aria-label="Connector steps">
            {["Connection", "Field mapping"].map((label, i) => (
              <button
                type="button"
                key={label}
                aria-current={connectorStep === i ? "step" : undefined}
                onClick={() => {
                  if (i === 0 || newConnName.trim()) setConnectorStep(i);
                  else setDialogError("Enter a connector name first.");
                }}
              >
                <span className="settings-step">{i + 1}</span>
                {label}
              </button>
            ))}
            <p>Your token is shown once after creation.</p>
          </nav>
          <div className="settings-connector-body">
            {dialogError && (
              <p role="alert" className="settings-message error">
                {dialogError}
              </p>
            )}
            {connectorStep === 0 ? (
              <section className="settings-section">
                <h2>Connection details</h2>
                <p>Choose where incoming leads should go.</p>
                <div className="settings-fields">
                  <label htmlFor="connector-name">
                    Connector name <span>*</span>
                    <input
                      id="connector-name"
                      value={newConnName}
                      onChange={(e) => setNewConnName(e.target.value)}
                      placeholder="e.g. Apify London retailers"
                    />
                  </label>
                  <label>
                    Source type
                    <LeadSelect
                      label="Source type"
                      value={newConnSourceType}
                      onChange={setNewConnSourceType}
                      options={sourceOptions}
                    />
                  </label>
                  <label>
                    Target collection
                    <LeadSelect
                      label="Target collection"
                      value={newConnCollectionId}
                      onChange={setNewConnCollectionId}
                      options={collectionOptions}
                    />
                  </label>
                  <label>
                    Match behavior
                    <LeadSelect
                      label="Match behavior"
                      value={newConnMode}
                      onChange={setNewConnMode}
                      options={modeOptions}
                    />
                  </label>
                  <label htmlFor="batch-limit">
                    Maximum records per batch
                    <input
                      id="batch-limit"
                      type="number"
                      min={1}
                      max={500}
                      required
                      value={newConnBatchLimit}
                      onChange={(e) => setNewConnBatchLimit(Number(e.target.value))}
                    />
                  </label>
                </div>
              </section>
            ) : (
              <section className="settings-section space-y-5">
                <div className="settings-summary settings-section-heading">
                  <div>
                    <strong>{newConnName}</strong>
                    <p>
                      {sourceOptions.find((o) => o.value === newConnSourceType)?.label} ·{" "}
                      {collections.find((c) => c.id === newConnCollectionId)?.name ||
                        "General workspace"}
                    </p>
                  </div>
                  <button type="button" onClick={() => setConnectorStep(0)}>
                    Edit
                  </button>
                </div>
                <div className="settings-section-heading">
                  <div>
                    <h2>Map incoming fields</h2>
                    <p>Match your source keys to lead fields.</p>
                  </div>
                  <button
                    type="button"
                    className="settings-button"
                    onClick={() => void handleSuggestMapping()}
                  >
                    Suggest from sample
                  </button>
                </div>
                <label className="settings-field" htmlFor="connector-sample">
                  Sample JSON record
                  <textarea
                    id="connector-sample"
                    className="settings-code"
                    rows={6}
                    value={testSample}
                    onChange={(e) => setTestSample(e.target.value)}
                  />
                </label>
                <div className="settings-section-heading">
                  <h3>Field mappings</h3>
                  <button
                    type="button"
                    onClick={() =>
                      setMappingEntries((prev) => [...prev, { source: "", target: "company_name" }])
                    }
                  >
                    + Add field
                  </button>
                </div>
                <div className="settings-mappings">
                  {mappingEntries.map((m, i) => (
                    <div key={i}>
                      <input
                        aria-label={`Source key ${i + 1}`}
                        placeholder="Source key"
                        value={m.source}
                        onChange={(e) =>
                          setMappingEntries((prev) =>
                            prev.map((entry, n) =>
                              n === i ? { ...entry, source: e.target.value } : entry,
                            ),
                          )
                        }
                      />
                      <span>→</span>
                      <LeadSelect
                        label={`Target field ${i + 1}`}
                        value={m.target}
                        options={targetOptions}
                        onChange={(value) =>
                          setMappingEntries((prev) =>
                            prev.map((entry, n) => (n === i ? { ...entry, target: value } : entry)),
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label={`Remove mapping ${i + 1}`}
                        onClick={() => setMappingEntries((prev) => prev.filter((_, n) => n !== i))}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="settings-button"
                  disabled={testingMapping}
                  onClick={() => void handleTestMapping()}
                >
                  <Play size={15} />
                  {testingMapping ? "Testing…" : "Test mapping"}
                </button>
                {testResult && (
                  <details className="settings-evidence" open>
                    <summary>
                      {testResult.missing_fields.length
                        ? `Mapping preview · ${testResult.missing_fields.length} missing fields`
                        : "Mapping preview"}
                    </summary>
                    {testResult.missing_fields.length > 0 && (
                      <p>Missing: {testResult.missing_fields.join(", ")}</p>
                    )}
                    <pre>{JSON.stringify(testResult.transformed, null, 2)}</pre>
                  </details>
                )}
                <p className="settings-hint">
                  Your ingestion token will be shown once after creation.
                </p>
              </section>
            )}
          </div>
          <footer className="settings-footer">
            <button
              type="button"
              className="settings-button"
              disabled={submittingConn}
              onClick={() => setCreateModalOpen(false)}
            >
              Cancel
            </button>
            <div className="settings-actions">
              {connectorStep === 1 && (
                <button
                  type="button"
                  className="settings-button"
                  disabled={submittingConn}
                  onClick={() => setConnectorStep(0)}
                >
                  <ArrowLeft size={16} />
                  Back
                </button>
              )}
              <button className="settings-button primary" type="submit" disabled={submittingConn}>
                {submittingConn
                  ? "Creating…"
                  : connectorStep === 0
                    ? "Continue"
                    : "Create & reveal token"}
                {connectorStep === 0 && <ChevronRight size={16} />}
              </button>
            </div>
          </footer>
        </form>
      </FeatureDialog>
      <FeatureDialog
        open={collectionModalOpen}
        onClose={() => setCollectionModalOpen(false)}
        title="New collection"
        description="Group related leads and set their defaults."
        maxWidthClass="max-w-[600px]"
        layout="settings"
        isSubmitting={submittingColl}
      >
        <form className="settings-collection-dialog" onSubmit={handleCreateCollection}>
          <div className="settings-dialog-body settings-collection-form">
            {dialogError && (
              <p className="settings-message error" role="alert">
                {dialogError}
              </p>
            )}
            <label className="settings-field" htmlFor="collection-name">
              Collection name *
              <input
                id="collection-name"
                required
                value={newCollName}
                onChange={(e) => setNewCollName(e.target.value)}
                placeholder="e.g. London luxury retailers"
              />
            </label>
            <label className="settings-field" htmlFor="collection-description">
              Description <span className="settings-optional">Optional</span>
              <textarea
                id="collection-description"
                rows={3}
                value={newCollDesc}
                onChange={(e) => setNewCollDesc(e.target.value)}
                placeholder="What is this collection for?"
              />
            </label>
            <fieldset>
              <legend>Match behavior</legend>
              <div className="settings-mode-options">
                {modeOptions.map((o) => (
                  <label key={o.value} data-selected={newCollMode === o.value}>
                    <input
                      type="radio"
                      name="collection-mode"
                      value={o.value}
                      checked={newCollMode === o.value}
                      onChange={() => setNewCollMode(o.value)}
                    />
                    <div>
                      <strong>{o.label}</strong>
                      <p>
                        {o.value === "strict"
                          ? "All mandatory criteria must be supported."
                          : "Rank promising leads and show any gaps."}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="settings-field">
              <span>Contact needed</span>
              <LeadSelect
                label="Contact needed"
                value={newCollContact}
                onChange={setNewCollContact}
                options={contactOptions}
              />
            </div>
            <p className="settings-hint">These defaults apply to leads added to this collection.</p>
          </div>
          <footer className="settings-footer">
            <button
              type="button"
              className="settings-button"
              disabled={submittingColl}
              onClick={() => setCollectionModalOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" className="settings-button primary" disabled={submittingColl}>
              {submittingColl ? "Creating…" : "Create collection"}
            </button>
          </footer>
        </form>
      </FeatureDialog>
      <FeatureDialog
        open={Boolean(revealedToken)}
        onClose={() => setRevealedToken(null)}
        title="Save your ingestion token"
        description="This token is shown once. Store it before closing."
        maxWidthClass="max-w-[600px]"
      >
        <div className="settings-collection-form">
          <label className="settings-field" htmlFor="revealed-token">
            Scoped token
            <input id="revealed-token" readOnly value={revealedToken || ""} />
          </label>
          <button
            type="button"
            className="settings-button"
            onClick={() => void copyToken(revealedToken || "")}
          >
            {tokenCopied ? <Check size={16} /> : <Copy size={16} />}
            {tokenCopied ? "Copied" : "Copy token"}
          </button>
          <label className="settings-field" htmlFor="revealed-endpoint">
            Ingestion endpoint
            <input
              id="revealed-endpoint"
              readOnly
              value={`${originUrl}/api/v1/inbound/ingest/${revealedConnectorId}`}
            />
          </label>
          <footer className="settings-footer">
            <button
              type="button"
              className="settings-button primary"
              onClick={() => setRevealedToken(null)}
            >
              I have saved my token
            </button>
          </footer>
        </div>
      </FeatureDialog>
      <FeatureDialog
        open={Boolean(selectedConnector)}
        onClose={() => setSelectedConnector(null)}
        title={selectedConnector?.name || "Connector details"}
        description="Connection settings and ingestion endpoint."
        maxWidthClass="max-w-[600px]"
      >
        {selectedConnector && (
          <div className="settings-collection-form">
            <dl className="settings-detail-list">
              <div>
                <dt>Source</dt>
                <dd>{selectedConnector.source_type}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{selectedConnector.status}</dd>
              </div>
              <div>
                <dt>Match behavior</dt>
                <dd>
                  {selectedConnector.default_qualification_mode === "best_match"
                    ? "Best match"
                    : "Strict match"}
                </dd>
              </div>
              <div>
                <dt>Collection</dt>
                <dd>
                  {collections.find((c) => c.id === selectedConnector.collection_id)?.name ||
                    "General workspace"}
                </dd>
              </div>
              <div>
                <dt>Connector ID</dt>
                <dd>{selectedConnector.id}</dd>
              </div>
            </dl>
            <label className="settings-field" htmlFor="detail-endpoint">
              Endpoint
              <input
                id="detail-endpoint"
                readOnly
                value={`${originUrl}/api/v1/inbound/ingest/${selectedConnector.id}`}
              />
            </label>
            <button
              type="button"
              className="settings-button"
              onClick={() =>
                void copyToken(
                  `${originUrl}/api/v1/inbound/ingest/${selectedConnector.id}`,
                  selectedConnector.id,
                )
              }
            >
              <Copy size={16} />
              {copiedEndpoint === selectedConnector.id ? "Copied" : "Copy endpoint"}
            </button>
          </div>
        )}
      </FeatureDialog>
    </div>
  );
}
