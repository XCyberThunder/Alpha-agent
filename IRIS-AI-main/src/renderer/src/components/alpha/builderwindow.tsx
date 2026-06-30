"use client";

/**
 * ALPHA — All-in-one builder window.
 *
 * This single file contains the entire ALPHA code editor UI:
 *   icons, menus, title bar, activity bar, file explorer, coding agent,
 *   model & access selectors, tab bar, breadcrumbs, functional code editor
 *   with autocomplete, live preview, status bar, terminal panel,
 *   extensions panel, welcome page, settings panel, profile panel,
 *   and the main BuilderWindow component that wires everything together.
 */

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import "@renderer/assets/builderwindow-globals.css";
import {
  Files, Search, Sparkles, GitBranch, Bug, Blocks, User, Settings,
  ChevronRight, ChevronDown, FileText, FileCode2, FileJson, FileCog,
  File as FileIcon, Folder, FolderOpen, MoreHorizontal, RefreshCw,
  ListTree, ListChecks, Filter, Plus, History, Paperclip, AtSign, ArrowUp, Code2,
  Wrench, Check, Cpu, Zap, Brain, X, Shield, ShieldCheck, ShieldAlert,
  Lock, Globe, Terminal as TerminalIcon, Eye, Columns2, SplitSquareHorizontal,
  Camera, Monitor, Wifi, BatteryFull, Signal, Mic, Play, RefreshCw as Refresh,
  GitBranch as GitIcon, AlertCircle, Info, Bell, Radio, ChevronLeft,
  Minus, Square, LayoutGrid, Plug, Star, Bot, Box, TerminalSquare,
  Container, ArrowRight, MessageSquare, Maximize2, Undo2, FileSearch,
  TestTube, BookOpen, KeyRound, Bell as BellIcon, Palette, Keyboard,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@renderer/lib/utils";
import {
  Popover, PopoverTrigger, PopoverContent,
  ResizablePanel as Panel,
  ResizablePanelGroup as PanelGroup,
  ResizableHandle as PanelResizeHandle,
} from "@renderer/components/ui";
import {
  type BuilderWorkspaceNode,
  type BuilderWorkspaceSearchResult,
  type BuilderWorkspaceSnapshot,
  type BuilderWorkspaceSummary,
  clearBuilderRecentWorkspaces,
  createBuilderWorkspaceFile,
  createBuilderWorkspaceFolder,
  disposeBuilderTerminal,
  getBuilderWorkspaceState,
  openBuilderLooseFileDialog,
  openBuilderTerminal,
  openBuilderWorkspace,
  openBuilderWorkspaceFolderDialog,
  readBuilderWorkspaceFile,
  refreshBuilderWorkspace,
  searchBuilderWorkspace,
  sendBuilderTerminalInput,
  type BuilderWorkspaceTerminalEvent,
  writeBuilderWorkspaceFile,
} from "@renderer/services/builder-workspace";
import {
  cancelBuilderRequest,
  chatBuilderPrompt,
  createBuilderProject,
  getBuilderModelStatuses,
  getBuilderWindowState,
  type BuilderModelStatuses,
  setBuilderModelEnabled,
  type BuilderProjectState,
  type BuilderProviderSelection,
  saveBuilderProjectFile,
  testBuilderModelSlot,
  updateBuilderProject,
} from "@renderer/services/project-builder";

function TerminalPanel({
  onClose,
  onMinimize,
  height,
  workspacePath,
  queuedCommand,
  onQueuedCommandHandled,
}: {
  onClose: () => void
  onMinimize: () => void
  height: number
  workspacePath?: string | null
  queuedCommand?: string | null
  onQueuedCommandHandled?: () => void
}) {
  const [activeTab, setActiveTab] = useState<PanelTab>("terminal");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shellLabel, setShellLabel] = useState("shell");
  const [cwd, setCwd] = useState(workspacePath ?? "");
  const [output, setOutput] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = window.electron.ipcRenderer.on(
      "builder-workspace-terminal-event",
      (_event, payload: BuilderWorkspaceTerminalEvent) => {
        if (!sessionIdRef.current || payload.sessionId !== sessionIdRef.current) return;
        if (payload.type === "stdout" || payload.type === "stderr") {
          setOutput((prev) => [...prev, payload.text ?? ""]);
        }
        if (payload.type === "error") {
          setOutput((prev) => [...prev, payload.text ?? "Terminal error"]);
        }
        if (payload.type === "exit") {
          setExitCode(payload.exitCode ?? null);
          setOutput((prev) => [...prev, `\n[process exited${payload.exitCode !== null && payload.exitCode !== undefined ? `: ${payload.exitCode}` : ""}]`]);
        }
      }
    );

    openBuilderTerminal(workspacePath ?? undefined).then((response) => {
      if (disposed) return;
      if (!response.success || !response.sessionId) {
        setOutput([response.error ?? "Failed to start terminal session."]);
        return;
      }
      sessionIdRef.current = response.sessionId;
      setSessionId(response.sessionId);
      setShellLabel(response.shell ?? "shell");
      setCwd(response.cwd ?? workspacePath ?? "");
      setOutput((prev) => [...prev, `${response.shell ?? "shell"} ready in ${response.cwd ?? workspacePath ?? ""}`]);
    });

    return () => {
      disposed = true;
      unsubscribe?.();
      const currentSession = sessionIdRef.current;
      if (currentSession) {
        void disposeBuilderTerminal(currentSession);
        sessionIdRef.current = null;
      }
    };
  }, [workspacePath]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output]);

  const runInput = useCallback(async () => {
    const command = input.trimEnd();
    if (!command || !sessionIdRef.current) return;
    setOutput((prev) => [...prev, `${cwd || "~"} > ${command}`]);
    setInput("");
    setExitCode(null);
    await sendBuilderTerminalInput(sessionIdRef.current, `${command}\n`);
  }, [cwd, input]);

  useEffect(() => {
    if (!queuedCommand || !sessionIdRef.current) return;
    setOutput((prev) => [...prev, `${cwd || "~"} > ${queuedCommand}`]);
    setExitCode(null);
    void sendBuilderTerminalInput(sessionIdRef.current, `${queuedCommand}\n`);
    onQueuedCommandHandled?.();
  }, [cwd, onQueuedCommandHandled, queuedCommand, sessionId]);

  return (
    <div className="flex shrink-0 flex-col border-t border-[#2b2b2b] bg-[#1e1e1e]" style={{ height }}>
      <div className="flex h-9 items-stretch border-b border-[#2b2b2b] pr-2">
        <div className="flex flex-1 items-stretch">
          {termTabs.map((t) => {
            const Icon = t.Icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 border-r border-[#2b2b2b] px-3 text-[11px] font-medium tracking-wider transition-colors",
                  isActive ? "bg-[#1e1e1e] text-[#ffffff]" : "text-[#858585] hover:bg-white/[0.04] hover:text-[#cccccc]",
                )}
              >
                <Icon size={12} className={isActive ? "text-[#cccccc]" : "text-[#6a6a6a]"} />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          <button className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#cccccc] hover:bg-white/[0.06]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" /> {shellLabel}
          </button>
          <button onClick={onMinimize} className="rounded p-1 text-[#858585] hover:bg-white/[0.06] hover:text-[#cccccc]" title="Minimize"><ChevronDown size={14} /></button>
          <button onClick={onClose} className="rounded p-1 text-[#858585] hover:bg-white/[0.06] hover:text-[#cccccc]" title="Close"><X size={14} /></button>
        </div>
      </div>
      <div className="alpha-scroll-thin flex-1 overflow-y-auto p-2 font-mono text-[12.5px] leading-[1.5]" ref={scrollRef}>
        {activeTab === "terminal" ? (
          <div className="space-y-1">
            {output.length === 0 ? (
              <div className="text-[#6a6a6a]">Starting terminal…</div>
            ) : (
              output.map((line, index) => (
                <div key={`${index}-${line.slice(0, 16)}`} className="whitespace-pre-wrap text-[#cccccc]">
                  {line || "\u00a0"}
                </div>
              ))
            )}
          </div>
        ) : activeTab === "problems" ? (
          <div className="text-[12px] text-[#858585]">Problems panel will reflect diagnostics from the real workspace.</div>
        ) : activeTab === "output" ? (
          <div className="text-[12px] text-[#858585]">Terminal and builder service output will appear here in later iterations.</div>
        ) : activeTab === "debug" ? (
          <div className="text-[12px] text-[#858585]">Debug console is not wired yet.</div>
        ) : (
          <div className="text-[12px] text-[#858585]">No forwarded ports for this workspace.</div>
        )}
      </div>
      {activeTab === "terminal" && (
        <div className="flex items-center gap-2 border-t border-[#2b2b2b] px-2 py-2">
          <span className="max-w-[32%] truncate font-mono text-[11px] text-[#6a6a6a]">{cwd || "No workspace"}</span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void runInput();
              }
            }}
            placeholder="Run a command in this workspace"
            className="flex-1 rounded-md border border-[#3c3c3c] bg-[#252526] px-2 py-1 text-[12px] text-[#cccccc] placeholder:text-[#6a6a6a] focus:border-[#007acc] focus:outline-none"
          />
          <button
            onClick={() => void runInput()}
            disabled={!input.trim() || !sessionId}
            className="rounded-md border border-[#3c3c3c] bg-[#252526] px-2.5 py-1 text-[11px] text-[#cccccc] transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Run
          </button>
          {exitCode !== null && <span className="text-[11px] text-[#858585]">exit {exitCode}</span>}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Types
   ============================================================ */
type ActivityView =
  | "explorer" | "search" | "agent" | "scm"
  | "debug" | "extensions" | "account";

type EditorMode = "code" | "preview" | "split";
type AccessLevel = "ask" | "safe" | "full";
type Mode = "agent" | "edit" | "build";
type PanelTab = "problems" | "output" | "debug" | "terminal" | "ports";

type FileNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  language?: string;
  badge?: "M" | "U" | "A";
  children?: FileNode[];
};

type OpenTab = {
  name: string
  path: string
  dirty?: boolean
  content: string
  workspacePath?: string | null
  isLoose?: boolean
}

type MenuItem =
  | { type: "item"; label: string; shortcut?: string; checked?: boolean; submenu?: MenuItem[]; actionId?: string }
  | { type: "separator" };

type MenuDef = { id: string; label: string; items: MenuItem[] };

type AlphaModel = {
  id: string; name: string; description: string;
  badge?: string; Icon: typeof Cpu;
};

type CodeToken = {
  t: "kw" | "str" | "fn" | "tag" | "attr" | "attr-val"
    | "com" | "num" | "type" | "plain" | "punct";
  v: string;
};

type CodeLine = { indent?: number; tokens: CodeToken[] };

type Suggestion = {
  label: string; detail: string; insert: string;
  kind: "kw" | "fn" | "snip" | "var";
};

type CursorState = {
  line: number
  col: number
}

type AgentMessage = {
  id: string
  role: "user" | "assistant" | "status"
  content: string
  createdAt: string
  providerLabel?: string
  error?: boolean
  loading?: boolean
  transient?: boolean
  tone?: "default" | "success" | "cancelled"
}

type BuilderModelOption = {
  id: string
  name: string
  description: string
  selection: BuilderProviderSelection
  configured: boolean
}

type BuilderWindowPayload = {
  state?: BuilderProjectState
  previewHtml?: string
  prompt?: string
  providerError?: string
  autoStart?: boolean
  selectedProvider?: string
}

type SearchGroup = {
  filePath: string
  fileName: string
  matches: BuilderWorkspaceSearchResult[]
}

type PendingCreateTarget = {
  kind: "file" | "folder"
  value: string
}

type BuilderPreferences = {
  autoSave: boolean
  wordWrap: boolean
  tabSize: number
  fontSize: number
  fontFamily: string
  defaultShell: string
}

type CodingContextState = {
  originalPrompt: string
  intent: Extract<BuilderAgentIntent, "CODING_GENERATE" | "CODING_EDIT">
  createdAt: string
}

type BuilderRequestLifecycleState = "idle" | "running" | "completed" | "failed" | "cancelled"

const BUILDER_PREFERENCES_KEY = "alpha-builder-preferences-v1";

const defaultBuilderPreferences: BuilderPreferences = {
  autoSave: false,
  wordWrap: false,
  tabSize: 2,
  fontSize: 12.5,
  fontFamily: "JetBrains Mono",
  defaultShell: "PowerShell",
};

function loadBuilderPreferences(): BuilderPreferences {
  if (typeof window === "undefined") return defaultBuilderPreferences;
  try {
    const raw = window.localStorage.getItem(BUILDER_PREFERENCES_KEY);
    if (!raw) return defaultBuilderPreferences;
    const parsed = JSON.parse(raw) as Partial<BuilderPreferences>;
    return {
      autoSave: typeof parsed.autoSave === "boolean" ? parsed.autoSave : defaultBuilderPreferences.autoSave,
      wordWrap: typeof parsed.wordWrap === "boolean" ? parsed.wordWrap : defaultBuilderPreferences.wordWrap,
      tabSize:
        typeof parsed.tabSize === "number" && Number.isFinite(parsed.tabSize) ? parsed.tabSize : defaultBuilderPreferences.tabSize,
      fontSize:
        typeof parsed.fontSize === "number" && Number.isFinite(parsed.fontSize)
          ? parsed.fontSize
          : defaultBuilderPreferences.fontSize,
      fontFamily:
        typeof parsed.fontFamily === "string" && parsed.fontFamily.trim()
          ? parsed.fontFamily.trim()
          : defaultBuilderPreferences.fontFamily,
      defaultShell:
        typeof parsed.defaultShell === "string" && parsed.defaultShell.trim()
          ? parsed.defaultShell.trim()
          : defaultBuilderPreferences.defaultShell,
    };
  } catch {
    return defaultBuilderPreferences;
  }
}

function LivePreview({
  previewPath,
  previewVersion,
}: {
  previewPath: string | null
  previewVersion: number
}) {
  if (!previewPath) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#1e1e1e]">
        <div className="rounded-md border border-[#3c3c3c] bg-[#252526] px-4 py-3 text-[12px] text-[#858585]">
          Open or create an HTML file to see a live preview.
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#1e1e1e]">
      <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-1.5 rounded-md bg-[#252526]/95 px-2 py-1 text-[10px] text-[#858585] ring-1 ring-[#3c3c3c]">
        <span className="h-2 w-2 rounded-full bg-[#f48771]/80" />
        <span className="h-2 w-2 rounded-full bg-[#e2c08d]/80" />
        <span className="h-2 w-2 rounded-full bg-[#73c991]/80" />
        <span className="ml-2 font-mono">Preview · {basename(previewPath)}</span>
      </div>
      <iframe
        key={`${previewPath}:${previewVersion}`}
        title="Builder Preview"
        src={fileToUri(previewPath, previewVersion)}
        className="h-full w-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
    </div>
  );
}

/* ============================================================
   ALPHA brand icon
   ============================================================ */
function ALPHAIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none"
      xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      <defs>
        <linearGradient id="alpha-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8"
        stroke="url(#alpha-grad)" strokeWidth="1.6" fill="rgba(16,185,129,0.06)" />
      <path d="M10 22.5 L16 9.5 L22 22.5"
        stroke="url(#alpha-grad)" strokeWidth="2.1"
        strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M12.5 18 L19.5 18"
        stroke="url(#alpha-grad)" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

/* ============================================================
   Project tree data
   ============================================================ */
const projectTree: FileNode[] = [
  {
    name: "ALPHA-MAIN", path: "ALPHA-MAIN", type: "folder",
    children: [
      {
        name: "src", path: "ALPHA-MAIN/src", type: "folder",
        children: [
          {
            name: "renderer", path: "ALPHA-MAIN/src/renderer", type: "folder",
            children: [
              {
                name: "src", path: "ALPHA-MAIN/src/renderer/src", type: "folder",
                children: [
                  {
                    name: "store", path: "ALPHA-MAIN/src/renderer/src/store", type: "folder",
                    children: [
                      { name: "agentStore.ts", path: "ALPHA-MAIN/src/renderer/src/store/agentStore.ts", type: "file", language: "typescript" },
                      { name: "visionStore.ts", path: "ALPHA-MAIN/src/renderer/src/store/visionStore.ts", type: "file", language: "typescript", badge: "M" },
                    ],
                  },
                  {
                    name: "tools", path: "ALPHA-MAIN/src/renderer/src/tools", type: "folder",
                    children: [
                      { name: "deepSearch-rag.ts", path: "ALPHA-MAIN/src/renderer/src/tools/deepSearch-rag.ts", type: "file", language: "typescript" },
                      { name: "image-generator.ts", path: "ALPHA-MAIN/src/renderer/src/tools/image-generator.ts", type: "file", language: "typescript" },
                      { name: "weather-api.ts", path: "ALPHA-MAIN/src/renderer/src/tools/weather-api.ts", type: "file", language: "typescript" },
                    ],
                  },
                  {
                    name: "types", path: "ALPHA-MAIN/src/renderer/src/types", type: "folder",
                    children: [
                      { name: "form-type.ts", path: "ALPHA-MAIN/src/renderer/src/types/form-type.ts", type: "file", language: "typescript" },
                    ],
                  },
                  {
                    name: "UI", path: "ALPHA-MAIN/src/renderer/src/UI", type: "folder",
                    children: [
                      { name: "alpha.tsx", path: "ALPHA-MAIN/src/renderer/src/UI/alpha.tsx", type: "file", language: "tsx", badge: "M" },
                      { name: "lockScreen.tsx", path: "ALPHA-MAIN/src/renderer/src/UI/lockScreen.tsx", type: "file", language: "tsx" },
                    ],
                  },
                  {
                    name: "utils", path: "ALPHA-MAIN/src/renderer/src/utils", type: "folder",
                    children: [
                      { name: "audioUtils.ts", path: "ALPHA-MAIN/src/renderer/src/utils/audioUtils.ts", type: "file", language: "typescript" },
                      { name: "ErrorBox.tsx", path: "ALPHA-MAIN/src/renderer/src/utils/ErrorBox.tsx", type: "file", language: "tsx" },
                    ],
                  },
                  {
                    name: "views", path: "ALPHA-MAIN/src/renderer/src/views", type: "folder",
                    children: [
                      { name: "APP.tsx", path: "ALPHA-MAIN/src/renderer/src/views/APP.tsx", type: "file", language: "tsx" },
                      { name: "builderwindow.tsx", path: "ALPHA-MAIN/src/renderer/src/views/builderwindow.tsx", type: "file", language: "tsx", badge: "M" },
                      { name: "Dashboard.tsx", path: "ALPHA-MAIN/src/renderer/src/views/Dashboard.tsx", type: "file", language: "tsx" },
                      { name: "Phone.tsx", path: "ALPHA-MAIN/src/renderer/src/views/Phone.tsx", type: "file", language: "tsx" },
                      { name: "Settings.tsx", path: "ALPHA-MAIN/src/renderer/src/views/Settings.tsx", type: "file", language: "tsx" },
                    ],
                  },
                  { name: "App.tsx", path: "ALPHA-MAIN/src/renderer/src/App.tsx", type: "file", language: "tsx" },
                  { name: "env.d.ts", path: "ALPHA-MAIN/src/renderer/src/env.d.ts", type: "file", language: "typescript" },
                ],
              },
            ],
          },
          { name: "main.ts", path: "ALPHA-MAIN/src/main.ts", type: "file", language: "typescript" },
        ],
      },
      {
        name: "public", path: "ALPHA-MAIN/public", type: "folder",
        children: [
          { name: "logo.svg", path: "ALPHA-MAIN/public/logo.svg", type: "file" },
          { name: "robots.txt", path: "ALPHA-MAIN/public/robots.txt", type: "file" },
        ],
      },
      { name: "vite.config.ts", path: "ALPHA-MAIN/vite.config.ts", type: "file", language: "typescript" },
      { name: "package.json", path: "ALPHA-MAIN/package.json", type: "file", language: "json" },
      { name: "tsconfig.json", path: "ALPHA-MAIN/tsconfig.json", type: "file", language: "json" },
      { name: "README.md", path: "ALPHA-MAIN/README.md", type: "file", language: "markdown" },
    ],
  },
];

const fileBreadcrumb: Record<string, string> = {
  "alpha.tsx": "ALPHA-MAIN / src / renderer / src / UI / alpha.tsx",
  "builderwindow.tsx": "ALPHA-MAIN / src / renderer / src / views / builderwindow.tsx",
};

const fileIcons: Record<string, { Icon: LucideIcon; color: string }> = {
  tsx: { Icon: FileCode2, color: "#519aba" },
  ts: { Icon: FileCode2, color: "#519aba" },
  js: { Icon: FileCode2, color: "#cbcb41" },
  jsx: { Icon: FileCode2, color: "#519aba" },
  json: { Icon: FileJson, color: "#cbcb41" },
  md: { Icon: FileText, color: "#519aba" },
  txt: { Icon: FileText, color: "#858585" },
  svg: { Icon: FileCog, color: "#e37933" },
};

function iconFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return fileIcons[ext] ?? { Icon: FileIcon, color: "#858585" };
}

function basename(targetPath: string) {
  const normalized = targetPath.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? targetPath;
}

function dirname(targetPath: string) {
  const normalized = targetPath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  parts.pop();
  return parts.join("/") || normalized;
}

function extname(targetPath: string) {
  const name = basename(targetPath);
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function toFileNode(node: BuilderWorkspaceNode): FileNode {
  return {
    name: node.name,
    path: node.path,
    type: node.type,
    language: node.ext,
    children: node.children?.map(toFileNode),
  };
}

function findFirstFile(nodes: BuilderWorkspaceNode[]): BuilderWorkspaceNode | null {
  for (const node of nodes) {
    if (node.type === "file") return node;
    const nested = node.children ? findFirstFile(node.children) : null;
    if (nested) return nested;
  }
  return null;
}

function findPreviewTarget(workspace: BuilderWorkspaceSnapshot | null, activeTab: OpenTab | null) {
  const activeExt = activeTab ? extname(activeTab.path) : "";
  if (activeTab && activeExt === "html") return activeTab.path;
  const firstHtml = workspace ? findFileByName(workspace.tree, "index.html") : null;
  return firstHtml?.path ?? null;
}

function findFileByName(nodes: BuilderWorkspaceNode[], fileName: string): BuilderWorkspaceNode | null {
  for (const node of nodes) {
    if (node.type === "file" && node.name.toLowerCase() === fileName.toLowerCase()) return node;
    const nested = node.children ? findFileByName(node.children, fileName) : null;
    if (nested) return nested;
  }
  return null;
}

function findNodeByPath(nodes: BuilderWorkspaceNode[], targetPath: string): BuilderWorkspaceNode | null {
  const normalizedTarget = targetPath.replace(/\\/g, "/").toLowerCase();
  for (const node of nodes) {
    if (node.path.replace(/\\/g, "/").toLowerCase() === normalizedTarget) return node;
    const nested = node.children ? findNodeByPath(node.children, targetPath) : null;
    if (nested) return nested;
  }
  return null;
}

function isWithinWorkspace(filePath: string, workspacePath?: string | null) {
  if (!workspacePath) return false;
  const normalizedFile = filePath.replace(/\\/g, "/").toLowerCase();
  const normalizedWorkspace = workspacePath.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
  return normalizedFile === normalizedWorkspace || normalizedFile.startsWith(`${normalizedWorkspace}/`);
}

function breadcrumbFromPath(targetPath: string, workspace?: BuilderWorkspaceSnapshot | null) {
  const normalized = targetPath.replace(/\\/g, "/");
  const workspaceRoot = workspace?.path.replace(/\\/g, "/");
  if (workspaceRoot && normalized.toLowerCase().startsWith(workspaceRoot.toLowerCase())) {
    const relative = normalized.slice(workspaceRoot.length).replace(/^\/+/, "");
    const parts = [workspace?.name ?? "workspace", ...relative.split("/").filter(Boolean)];
    return parts.join(" / ");
  }
  return normalized.split("/").filter(Boolean).join(" / ");
}

function languageLabel(filePath: string) {
  const ext = extname(filePath);
  if (!ext) return "Plain Text";
  const labels: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript JSX",
    js: "JavaScript",
    jsx: "JavaScript JSX",
    json: "JSON",
    md: "Markdown",
    html: "HTML",
    css: "CSS",
    py: "Python",
    txt: "Plain Text",
  };
  return labels[ext] ?? ext.toUpperCase();
}

function fileToUri(filePath: string, version: number) {
  const normalized = filePath.replace(/\\/g, "/");
  const prefixed = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${encodeURI(prefixed)}?v=${version}`;
}

function makeMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function chatStorageKey(workspacePath: string | null) {
  return `alpha-builder-chat:${workspacePath ?? "global"}`;
}

function loadStoredChat(workspacePath: string | null): AgentMessage[] {
  try {
    const raw = window.localStorage.getItem(chatStorageKey(workspacePath));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AgentMessage[];
    return Array.isArray(parsed) ? parsed.filter((message) => !message?.transient) : [];
  } catch {
    return [];
  }
}

function saveStoredChat(workspacePath: string | null, messages: AgentMessage[]) {
  try {
    window.localStorage.setItem(
      chatStorageKey(workspacePath),
      JSON.stringify(messages.filter((message) => !message.transient).slice(-80))
    );
  } catch {
    // ignore persistence errors
  }
}

function collectWorkspaceFilePaths(nodes: BuilderWorkspaceNode[], limit = 24, prefix = ""): string[] {
  const filePaths: string[] = [];
  for (const node of nodes) {
    const nextPath = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.type === "file") {
      filePaths.push(nextPath);
      if (filePaths.length >= limit) break;
      continue;
    }
    filePaths.push(...collectWorkspaceFilePaths(node.children ?? [], limit - filePaths.length, nextPath));
    if (filePaths.length >= limit) break;
  }
  return filePaths;
}

function providerDisplayName(provider: string) {
  const map: Record<string, string> = {
    kiloGateway: "Kilo Gateway",
    glm: "GLM",
    zai: "Z.AI",
    gemini: "Gemini",
    openrouter: "OpenRouter",
    kimi: "Kimi",
    groq: "Groq",
    routeway: "Routeway",
  };
  return map[provider] ?? provider;
}

function buildModelOptions(statuses?: BuilderModelStatuses): BuilderModelOption[] {
  const options: BuilderModelOption[] = [];

  const pushCompatibleGroup = (group: keyof BuilderModelStatuses, provider: Extract<BuilderProviderSelection, string> | never, fallbackModel?: string) => {
    const rows = statuses?.[group] ?? [];
    rows.forEach((row) => {
      const modelId = row.modelId?.trim() || fallbackModel || "";
      options.push({
        id: `${String(group)}-${row.slot}-${modelId || "default"}`,
        name: `${providerDisplayName(String(provider))} / ${modelId || `Slot ${row.slot}`}`,
        description: row.hasKey ? `Slot ${row.slot}${row.status ? ` · ${row.status}` : ""}` : `Slot ${row.slot} · not configured`,
        configured: row.hasKey && !!modelId,
        selection: {
          provider: provider as any,
          slot: row.slot,
          modelId,
          baseUrl: row.baseUrl,
          providerMode: row.providerMode,
          label: `${providerDisplayName(String(provider))} / ${modelId || `Slot ${row.slot}`}`,
        },
      });
    });
  };

  pushCompatibleGroup("kiloGateway", "kiloGateway" as any, "laguna-m.1:free");
  pushCompatibleGroup("glm", "glm" as any);
  pushCompatibleGroup("zai", "zai" as any);
  pushCompatibleGroup("geminiBrain" as keyof BuilderModelStatuses, "gemini" as any, "gemini-2.5-flash");
  pushCompatibleGroup("openrouter", "openrouter" as any);
  pushCompatibleGroup("kimi", "kimi" as any);
  pushCompatibleGroup("groq", "groq" as any);
  pushCompatibleGroup("routeway", "routeway" as any);

  if (!options.some((item) => (item.selection as any).provider === "kiloGateway")) {
    options.unshift({
      id: "kiloGateway-default",
      name: "Kilo Gateway / laguna-m.1:free",
      description: "Default Builder model",
      configured: false,
      selection: {
        provider: "kiloGateway",
        modelId: "laguna-m.1:free",
        label: "Kilo Gateway / laguna-m.1:free",
      },
    });
  }

  return options;
}

function findModelOption(
  options: BuilderModelOption[],
  targetId: string,
  fallbackId?: string | null
) {
  return (
    options.find((item) => item.id === targetId) ||
    (fallbackId ? options.find((item) => item.id === fallbackId) : undefined) ||
    options[0] ||
    null
  );
}

function resolveModelIdForProviderHint(
  options: BuilderModelOption[],
  providerHint?: string | null
) {
  if (!providerHint) return null;
  const normalizedHint = providerHint.trim().toLowerCase();
  const exact = options.find((item) => {
    const selection = item.selection as Exclude<BuilderProviderSelection, string>;
    return selection.provider.toLowerCase() === normalizedHint || item.id.toLowerCase() === normalizedHint;
  });
  if (exact) return exact.id;
  const loose = options.find((item) => item.name.toLowerCase().includes(normalizedHint));
  return loose?.id ?? null;
}

function buildMissingProviderMessage(option: BuilderModelOption | null) {
  const selection = option?.selection as Exclude<BuilderProviderSelection, string> | undefined;
  if (!selection) {
    return "Selected model configured nahi hai. Model settings check karo ya doosra model select karo.";
  }
  if (selection.provider === "kiloGateway") {
    return "Kilo Gateway API key missing hai. Settings me key add karo ya doosra model select karo.";
  }
  return "Selected model configured nahi hai. Model settings check karo ya doosra model select karo.";
}

type BuilderAgentIntent =
  | "NORMAL_CHAT"
  | "CODING_GENERATE"
  | "CODING_EDIT"
  | "EXPLAIN_CODE"
  | "RUN_COMMAND";

function classifyBuilderAgentPrompt(prompt: string, hasProject: boolean): BuilderAgentIntent {
  const text = prompt.trim().toLowerCase();
  if (!text) return "NORMAL_CHAT";

  const runCommandPattern =
    /^(npm|pnpm|yarn|bun|node|python|pip|git|dir|ls|gradle|mvn|cargo)\b/.test(text) ||
    /\b(run|chalao|execute)\b.*\b(build|test|dev|install|command)\b/.test(text);
  if (runCommandPattern) return "RUN_COMMAND";

  if (
    /^(hey|hello|hi|hii|yo|thanks|thank you|ok|okay|hmm|acha|achha|kya haal|what can you do)\b/.test(text) ||
    text.length < 18
  ) {
    return "NORMAL_CHAT";
  }

  if (/\b(explain|samjha|samjhao|what does|kaise work|why this)\b/.test(text) && !/\b(fix|edit|update|apply|change)\b/.test(text)) {
    return "EXPLAIN_CODE";
  }

  const generatePattern =
    /\b(website|webapp|app|dashboard|landing page|portfolio|clone|project|game|android app|desktop app)\b/.test(text) &&
    /\b(banao|bnao|banado|build|create|generate|make)\b/.test(text);
  if (generatePattern) return "CODING_GENERATE";

  const editPattern =
    /\b(edit|update|change|fix|refactor|replace|add|remove|responsive|theme|style|navbar|button|hero|code|file|index\.html|style\.css|script\.js)\b/.test(text);
  if (editPattern) {
    return hasProject ? "CODING_EDIT" : "CODING_GENERATE";
  }

  if (/\b(html|css|javascript|typescript|react|python|electron|component|login page)\b/.test(text)) {
    return hasProject ? "CODING_EDIT" : "CODING_GENERATE";
  }

  return "NORMAL_CHAT";
}

function toWorkspaceRelativePath(filePath: string, workspacePath?: string | null) {
  if (!workspacePath || !isWithinWorkspace(filePath, workspacePath)) return null;
  const normalizedWorkspace = workspacePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedFile = filePath.replace(/\\/g, "/");
  return normalizedFile.slice(normalizedWorkspace.length).replace(/^\/+/, "");
}

function findPreferredFilePath(snapshot: BuilderWorkspaceSnapshot | null, preferredRelativePath?: string | null) {
  if (!snapshot) return null;
  const requestedPath =
    preferredRelativePath && snapshot.path
      ? `${snapshot.path.replace(/[\\/]+$/, "")}/${preferredRelativePath.replace(/^[/\\]+/, "").replace(/\\/g, "/")}`
      : null;
  if (requestedPath && findNodeByPath(snapshot.tree, requestedPath)) {
    return requestedPath.replace(/\//g, snapshot.path.includes("\\") ? "\\" : "/");
  }

  const priorityNames = [
    "index.html",
    "src/App.tsx",
    "src/main.tsx",
    "main.py",
    "README.md",
    "style.css",
    "script.js",
  ];
  for (const name of priorityNames) {
    const found = findFileByName(snapshot.tree, basename(name));
    if (found) return found.path;
  }
  return findFirstFile(snapshot.tree)?.path ?? null;
}

/* ============================================================
   Menu definitions
   ============================================================ */
function buildMenus(recentWorkspaces: BuilderWorkspaceSummary[]): MenuDef[] {
  const recentItems: MenuItem[] = recentWorkspaces.length
    ? recentWorkspaces.map((workspace) => ({
        type: "item",
        label: workspace.name,
        actionId: `open-recent:${workspace.path}`,
      }))
    : [{ type: "item", label: "No Recent Folders", actionId: "noop:no-recents" }];

  return [
  {
    id: "file", label: "File",
    items: [
      { type: "item", label: "New Text File...", shortcut: "Ctrl+N" },
      { type: "item", label: "New File...", shortcut: "Ctrl+Alt+N" },
      { type: "item", label: "New Window", shortcut: "Ctrl+Shift+N" },
      { type: "separator" },
      { type: "item", label: "Open File...", shortcut: "Ctrl+O" },
      { type: "item", label: "Open Folder...", shortcut: "Ctrl+K Ctrl+O" },
      {
        type: "item", label: "Open Recent",
        submenu: [
          ...recentItems,
          { type: "separator" },
          { type: "item", label: "More..." },
          { type: "item", label: "Clear Recently Opened", actionId: "clear-recent" },
        ],
      },
      { type: "separator" },
      { type: "item", label: "Save", shortcut: "Ctrl+S" },
      { type: "item", label: "Save As...", shortcut: "Ctrl+Shift+S" },
      { type: "item", label: "Save All", shortcut: "Ctrl+K S" },
      { type: "separator" },
      {
        type: "item", label: "Auto Save",
        submenu: [
          { type: "item", label: "Off", checked: true },
          { type: "item", label: "After Delay" },
          { type: "item", label: "On Window Change" },
          { type: "item", label: "On Focus Change" },
        ],
      },
      {
        type: "item", label: "Preferences",
        submenu: [
          { type: "item", label: "Settings", shortcut: "Ctrl+,", actionId: "open-settings" },
          { type: "item", label: "Keyboard Shortcuts", shortcut: "Ctrl+K Ctrl+S" },
          { type: "item", label: "Color Theme", shortcut: "Ctrl+K Ctrl+T" },
        ],
      },
      { type: "separator" },
      { type: "item", label: "Close Editor", shortcut: "Ctrl+F4" },
      { type: "item", label: "Close Window", shortcut: "Alt+F4" },
      { type: "separator" },
      { type: "item", label: "Exit" },
    ],
  },
  {
    id: "edit", label: "Edit",
    items: [
      { type: "item", label: "Undo", shortcut: "Ctrl+Z" },
      { type: "item", label: "Redo", shortcut: "Ctrl+Y" },
      { type: "separator" },
      { type: "item", label: "Cut", shortcut: "Ctrl+X" },
      { type: "item", label: "Copy", shortcut: "Ctrl+C" },
      { type: "item", label: "Paste", shortcut: "Ctrl+V" },
      { type: "separator" },
      { type: "item", label: "Find", shortcut: "Ctrl+F" },
      { type: "item", label: "Replace", shortcut: "Ctrl+H" },
      { type: "item", label: "Find in Files", shortcut: "Ctrl+Shift+F", actionId: "open-search" },
    ],
  },
  {
    id: "selection", label: "Selection",
    items: [
      { type: "item", label: "Select All", shortcut: "Ctrl+A" },
      { type: "item", label: "Expand Selection", shortcut: "Shift+Alt+RightArrow" },
      { type: "item", label: "Shrink Selection", shortcut: "Shift+Alt+LeftArrow" },
      { type: "separator" },
      { type: "item", label: "Copy Line Up", shortcut: "Shift+Alt+UpArrow" },
      { type: "item", label: "Copy Line Down", shortcut: "Shift+Alt+DownArrow" },
      { type: "item", label: "Move Line Up", shortcut: "Alt+UpArrow" },
      { type: "item", label: "Move Line Down", shortcut: "Alt+DownArrow" },
      { type: "separator" },
      { type: "item", label: "Add Cursor Above", shortcut: "Ctrl+Alt+UpArrow" },
      { type: "item", label: "Add Cursor Below", shortcut: "Ctrl+Alt+DownArrow" },
      { type: "item", label: "Add Next Occurrence", shortcut: "Ctrl+D" },
    ],
  },
  {
    id: "view", label: "View",
    items: [
      { type: "item", label: "Command Palette...", shortcut: "Ctrl+Shift+P" },
      { type: "item", label: "Open View..." },
      { type: "separator" },
      {
        type: "item", label: "Appearance",
        submenu: [
          { type: "item", label: "Full Screen", shortcut: "F11" },
          { type: "item", label: "Zen Mode", shortcut: "Ctrl+K Z" },
        ],
      },
      { type: "separator" },
      { type: "item", label: "Explorer", shortcut: "Ctrl+Shift+E" },
      { type: "item", label: "Search", shortcut: "Ctrl+Shift+F", actionId: "open-search" },
      { type: "item", label: "Source Control", shortcut: "Ctrl+Shift+G" },
      { type: "item", label: "Run", shortcut: "Ctrl+Shift+D" },
      { type: "item", label: "Extensions", shortcut: "Ctrl+Shift+X" },
      { type: "separator" },
      { type: "item", label: "Problems", shortcut: "Ctrl+Shift+M" },
      { type: "item", label: "Output", shortcut: "Ctrl+Shift+U" },
      { type: "item", label: "Debug Console", shortcut: "Ctrl+Shift+Y" },
      { type: "item", label: "Terminal", shortcut: "Ctrl+`" },
      { type: "item", label: "Ports" },
    ],
  },
  {
    id: "go", label: "Go",
    items: [
      { type: "item", label: "Back", shortcut: "Alt+LeftArrow" },
      { type: "item", label: "Forward", shortcut: "Alt+RightArrow" },
      { type: "separator" },
      { type: "item", label: "Go to File...", shortcut: "Ctrl+P" },
      { type: "item", label: "Go to Symbol in Workspace...", shortcut: "Ctrl+T" },
      { type: "item", label: "Go to Definition", shortcut: "F12" },
      { type: "item", label: "Go to References", shortcut: "Shift+F12" },
      { type: "item", label: "Go to Line/Column...", shortcut: "Ctrl+G" },
    ],
  },
  {
    id: "run", label: "Run",
    items: [
      { type: "item", label: "Start Debugging", shortcut: "F5" },
      { type: "item", label: "Run Without Debugging", shortcut: "Ctrl+F5", actionId: "run-active-file" },
      { type: "item", label: "Stop Debugging", shortcut: "Shift+F5" },
      { type: "separator" },
      { type: "item", label: "Toggle Breakpoint", shortcut: "F9" },
      { type: "item", label: "Step Over", shortcut: "F10" },
      { type: "item", label: "Step Into", shortcut: "F11" },
    ],
  },
  {
    id: "terminal", label: "Terminal",
    items: [
      { type: "item", label: "New Terminal", shortcut: "Ctrl+Shift+`" },
      { type: "item", label: "Split Terminal", shortcut: "Ctrl+Shift+5" },
      { type: "separator" },
      { type: "item", label: "Run Task..." },
      { type: "item", label: "Run Build Task", shortcut: "Ctrl+Shift+B" },
      { type: "item", label: "Run Active File", actionId: "run-active-file" },
    ],
  },
  {
    id: "help", label: "Help",
    items: [
      { type: "item", label: "Welcome" },
      { type: "item", label: "Documentation" },
      { type: "item", label: "Keyboard Shortcuts Reference", shortcut: "Ctrl+K Ctrl+R" },
      { type: "separator" },
      { type: "item", label: "Report Issue" },
      { type: "separator" },
      { type: "item", label: "About ALPHA" },
    ],
  },
  {
    id: "more", label: "...",
    items: [
      { type: "item", label: "Command Palette...", shortcut: "Ctrl+Shift+P" },
      { type: "item", label: "Open Recent..." },
      { type: "item", label: "Tasks: Run Task..." },
      { type: "separator" },
      {
        type: "item", label: "Layout",
        submenu: [
          { type: "item", label: "Single Column" },
          { type: "item", label: "Two Columns" },
          { type: "item", label: "Two Rows" },
          { type: "item", label: "Grid (2x2)" },
        ],
      },
      {
        type: "item", label: "View",
        submenu: [
          { type: "item", label: "Explorer", shortcut: "Ctrl+Shift+E" },
          { type: "item", label: "Search", shortcut: "Ctrl+Shift+F" },
          { type: "item", label: "Source Control", shortcut: "Ctrl+Shift+G" },
          { type: "item", label: "Extensions", shortcut: "Ctrl+Shift+X" },
          { type: "separator" },
          { type: "item", label: "Terminal", shortcut: "Ctrl+`" },
          { type: "item", label: "Problems", shortcut: "Ctrl+Shift+M" },
        ],
      },
      {
        type: "item", label: "Appearance",
        submenu: [
          { type: "item", label: "Full Screen", shortcut: "F11" },
          { type: "item", label: "Zen Mode", shortcut: "Ctrl+K Z" },
          { type: "separator" },
          { type: "item", label: "Show Activity Bar", checked: true },
          { type: "item", label: "Show Status Bar", checked: true },
          { type: "item", label: "Show Side Bar", checked: true },
        ],
      },
      { type: "separator" },
      { type: "item", label: "Settings", shortcut: "Ctrl+,", actionId: "open-settings" },
      { type: "item", label: "Keyboard Shortcuts", shortcut: "Ctrl+K Ctrl+S" },
      { type: "item", label: "Color Theme", shortcut: "Ctrl+K Ctrl+T" },
      { type: "separator" },
      { type: "item", label: "Welcome" },
      { type: "item", label: "Documentation" },
      { type: "item", label: "Report Issue" },
      { type: "separator" },
      { type: "item", label: "About ALPHA" },
    ],
  },
];
}

/* ============================================================
   MenuBar (dropdown menus)
   ============================================================ */
function MenuBar({
  menus: menuList,
  onAnyAction,
}: {
  menus: MenuDef[];
  onAnyAction?: (menuId: string, item: Extract<MenuItem, { type: "item" }>) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openId) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenId(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpenId(null); }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId]);

  return (
    <div ref={rootRef} className="flex items-center gap-0.5 select-none">
      {menuList.map((m) => {
        const isOpen = openId === m.id;
        return (
          <div key={m.id} className="relative">
            <button
              onClick={() => setOpenId(isOpen ? null : m.id)}
              onMouseEnter={() => { if (openId && openId !== m.id) setOpenId(m.id); }}
              className={cn(
                "rounded px-2 py-0.5 text-[12px] transition-colors",
                isOpen ? "bg-white/10 text-white" : "text-[#cccccc] hover:bg-white/5",
              )}
            >
              {m.label}
            </button>
            {isOpen && (
              <Dropdown
                items={m.items}
                onClose={() => { setOpenId(null); }}
                onAction={(item) => onAnyAction?.(m.id, item)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Dropdown({
  items, onClose, onAction, nested,
}: {
  items: MenuItem[];
  onClose: () => void;
  onAction: (item: Extract<MenuItem, { type: "item" }>) => void;
  nested?: boolean;
}) {
  const [submenuIndex, setSubmenuIndex] = useState<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setSubmenuIndex(null);
    }, 140);
  }, [clearCloseTimer]);

  return (
    <div className={cn(
      "absolute z-[160] min-w-[260px] animate-fade-in rounded-md border border-[#454545] bg-[#252526] py-1 shadow-2xl",
      nested ? "left-full top-0 ml-0.5" : "left-0 top-full mt-0.5",
    )}
      onMouseEnter={clearCloseTimer}
      onMouseLeave={scheduleClose}
    >
      {items.map((item, i) => {
        if (item.type === "separator") {
          return <div key={i} className="my-1 h-px bg-[#454545]" />;
        }
        const hasSubmenu = !!item.submenu?.length;
        const isSubmenuOpen = submenuIndex === i;
        return (
          <div key={i} className="relative">
            <button
              onClick={() => {
                if (hasSubmenu) return;
                onAction(item);
                onClose();
              }}
              onMouseEnter={() => {
                clearCloseTimer();
                if (hasSubmenu) setSubmenuIndex(i);
                else setSubmenuIndex(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-[3px] text-left text-[12px] text-[#cccccc] hover:bg-[#04395e] hover:text-white"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {item.checked && <Check size={12} className="text-[#cccccc]" />}
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              {item.shortcut && (
                <span className="ml-6 shrink-0 text-[11px] text-[#858585]">{item.shortcut}</span>
              )}
              {hasSubmenu && <ChevronRight size={12} className="shrink-0 text-[#858585]" />}
            </button>
            {hasSubmenu && isSubmenuOpen && (
              <Dropdown
                items={item.submenu!}
                onClose={onClose}
                onAction={onAction}
                nested
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   TitleBar
   ============================================================ */
function TitleBar({
  workspaceLabel,
  menus,
  onMenuAction,
  onWindowAction,
}: {
  workspaceLabel: string
  menus: MenuDef[]
  onMenuAction?: (menuId: string, label: string, actionId?: string) => void
  onWindowAction?: (action: "minimize" | "maximize" | "close") => void
}) {
  return (
    <div
      className="relative z-[120] flex h-9 items-center justify-between overflow-visible border-b border-black/40 bg-[#3c3c3c] px-2 text-[12px] text-[#cccccc] select-none"
      style={{ ["WebkitAppRegion" as any]: "drag" }}
    >
      <div className="flex items-center" style={{ ["WebkitAppRegion" as any]: "no-drag" }}>
        <MenuBar menus={menus} onAnyAction={(menuId, item) => onMenuAction?.(menuId, item.label, item.actionId)} />
      </div>
      <div className="absolute left-1/2 top-1/2 flex w-[min(440px,40vw)] -translate-x-1/2 -translate-y-1/2 items-center" style={{ ["WebkitAppRegion" as any]: "no-drag" }}>
        <div className="flex h-6 w-full items-center gap-2 rounded-md border border-[#4a4a4a] bg-[#252526] px-2 text-[12px] text-[#969696] hover:border-[#5a5a5a] hover:bg-[#2a2a2a]">
          <Search size={13} className="shrink-0 text-[#969696]" />
          <span className="truncate">{workspaceLabel}</span>
          <ChevronDown size={12} className="shrink-0 text-[#6a6a6a]" />
        </div>
      </div>
      <div className="flex items-center" style={{ ["WebkitAppRegion" as any]: "no-drag" }}>
        <WindowBtn title="Minimize" onClick={() => onWindowAction?.("minimize")}><Minus size={14} strokeWidth={1.5} /></WindowBtn>
        <WindowBtn title="Maximize" onClick={() => onWindowAction?.("maximize")}><Square size={11} strokeWidth={1.5} /></WindowBtn>
        <WindowBtn title="Close" danger onClick={() => onWindowAction?.("close")}><X size={14} strokeWidth={1.5} /></WindowBtn>
      </div>
    </div>
  );
}

function WindowBtn({
  title, children, danger, onClick,
}: {
  title: string; children: React.ReactNode; danger?: boolean; onClick?: () => void;
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
      className={cn(
        "flex h-9 w-11 items-center justify-center transition-colors",
        danger ? "text-[#cccccc] hover:bg-[#e81123] hover:text-white" : "text-[#cccccc] hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}

/* ============================================================
   ActivityBar
   ============================================================ */
const topItems: { id: ActivityView; icon: LucideIcon | "alpha"; label: string; badge?: number }[] = [
  { id: "explorer", icon: "alpha", label: "ALPHA" },
  { id: "explorer", icon: Files, label: "Explorer" },
  { id: "search", icon: Search, label: "Search" },
  { id: "agent", icon: Sparkles, label: "Coding Agent" },
  { id: "scm", icon: GitBranch, label: "Source Control", badge: 3 },
  { id: "debug", icon: Bug, label: "Run and Debug" },
  { id: "extensions", icon: Blocks, label: "Extensions" },
];

function ActivityBar({
  active, onSelect, onSettingsClick,
}: {
  active: ActivityView;
  onSelect: (v: ActivityView) => void;
  onSettingsClick?: () => void;
}) {
  return (
    <div className="relative z-20 flex h-full w-12 flex-col items-center justify-between border-r border-black/40 bg-[#333333] py-1">
      <div className="flex flex-col items-center gap-0.5">
        {topItems.map((item, idx) => (
          <ActivityButton
            key={`${item.id}-${idx}`} item={item}
            active={active === item.id} onSelect={onSelect}
          />
        ))}
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <ActivityButton
          item={{ id: "account", icon: User, label: "Account" }}
          active={active === "account"} onSelect={onSelect}
        />
        <button
          title="Manage"
          onClick={onSettingsClick}
          className="flex h-10 w-10 items-center justify-center rounded-md text-[#858585] transition-colors hover:text-[#cccccc]"
        >
          <Settings size={18} strokeWidth={1.6} />
        </button>
      </div>
    </div>
  );
}

function ActivityButton({
  item, active, onSelect,
}: {
  item: { id: ActivityView; icon: LucideIcon | "alpha"; label: string; badge?: number };
  active: boolean;
  onSelect: (v: ActivityView) => void;
}) {
  const isAgent = item.id === "agent";
  const isAlpha = item.icon === "alpha";

  if (isAlpha) {
    return (
      <button
        title={item.label}
        onClick={() => onSelect(item.id)}
        className="group relative flex h-10 w-10 items-center justify-center"
      >
        {active && <span className="activity-indicator" />}
        <ALPHAIcon size={20} />
      </button>
    );
  }

  const Icon = item.icon as LucideIcon;
  return (
    <button
      title={item.label}
      onClick={() => onSelect(item.id)}
      className={cn(
        "group relative flex h-10 w-10 items-center justify-center rounded-md transition-colors",
        active ? (isAgent ? "text-[#10b981]" : "text-[#ffffff]") : "text-[#858585] hover:text-[#cccccc]",
      )}
    >
      {active && <span className="activity-indicator" />}
      <Icon size={18} strokeWidth={1.6} className="no-drag" />
      {isAgent && !active && (
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#10b981] shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
      )}
      {item.badge ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#007acc] px-1 text-[9px] font-bold text-white">
          {item.badge}
        </span>
      ) : null}
    </button>
  );
}

export { ActivityBar as _ActivityBar }; // re-export for type checks

/* ============================================================
   FileExplorer (with collapsible Outline)
   ============================================================ */
function FileExplorer({
  workspaceName,
  tree,
  activePath,
  selectedPath,
  onOpenFile,
  onSelectPath,
  onCreateFile,
  onCreateFolder,
  onRefresh,
}: {
  workspaceName: string
  tree: FileNode[]
  activePath: string
  selectedPath?: string | null
  onOpenFile: (name: string, path: string) => void
  onSelectPath: (path: string, type: "file" | "folder") => void
  onCreateFile: () => void
  onCreateFolder: () => void
  onRefresh: () => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col bg-[#252526] text-[#cccccc]">
      <div className="flex h-9 items-center justify-between px-3 pt-2">
        <span className="text-[11px] font-semibold tracking-[0.14em] text-[#cccccc]">EXPLORER</span>
        <MoreHorizontal size={14} className="text-[#858585] hover:text-[#cccccc]" />
      </div>
      <div className="group flex h-6 items-center justify-between pl-2 pr-3 text-[11px] font-bold tracking-[0.12em] text-[#cccccc]">
        <button className="flex items-center gap-1 hover:text-white" onClick={() => toggle(workspaceName)}>
          {collapsed.has(workspaceName) ? <ChevronRight size={14} className="text-[#858585]" /> : <ChevronDown size={14} className="text-[#858585]" />}
          {workspaceName}
        </button>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={onCreateFile} title="New File" className="text-[#858585] hover:text-[#cccccc]"><FileText size={13} /></button>
          <button onClick={onCreateFolder} title="New Folder" className="text-[#858585] hover:text-[#cccccc]"><Folder size={13} /></button>
          <button onClick={onRefresh} title="Refresh" className="text-[#858585] hover:text-[#cccccc]"><RefreshCw size={13} /></button>
        </div>
      </div>
      <div className="alpha-scroll-thin min-h-0 flex-1 overflow-y-auto pb-3 text-[13px] leading-6">
        {collapsed.has(workspaceName) ? null : tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={1}
            collapsed={collapsed}
            onToggle={toggle}
            activePath={activePath}
            selectedPath={selectedPath}
            onOpenFile={onOpenFile}
            onSelectPath={onSelectPath}
          />
        ))}
        {tree.length === 0 && (
          <div className="px-3 py-4 text-[12px] text-[#858585]">This folder is empty.</div>
        )}
      </div>
      <div className="shrink-0 border-t border-black/40">
        <button
          onClick={() => setOutlineCollapsed((v) => !v)}
          className="flex h-7 w-full items-center justify-between px-3 hover:bg-white/[0.04]"
        >
          <div className="flex items-center gap-1.5">
            {outlineCollapsed ? <ChevronRight size={13} className="text-[#858585]" />
              : <ChevronDown size={13} className="text-[#858585]" />}
            <ListTree size={13} className="text-[#858585]" />
            <span className="text-[11px] font-semibold tracking-[0.14em] text-[#cccccc]">OUTLINE</span>
          </div>
          <Filter size={13} className="text-[#858585]" />
        </button>
        {!outlineCollapsed && (
          <div className="px-3 pb-3 text-[12px] text-[#858585]">
            <div className="rounded-md border border-dashed border-[#3c3c3c] bg-[#1e1e1e] px-2 py-2 leading-relaxed">
              Outline view will appear here for supported file types.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TreeNode({
  node, depth, collapsed, onToggle, activePath, selectedPath, onOpenFile, onSelectPath,
}: {
  node: FileNode; depth: number;
  collapsed: Set<string>; onToggle: (path: string) => void;
  activePath: string;
  selectedPath?: string | null;
  onOpenFile: (name: string, path: string) => void;
  onSelectPath: (path: string, type: "file" | "folder") => void;
}) {
  const isFolder = node.type === "folder";
  const isCollapsed = collapsed.has(node.path);
  const isActive = activePath === node.path;
  const isSelected = selectedPath === node.path;

  if (isFolder) {
    return (
      <div>
        <button
          onClick={() => {
            onToggle(node.path);
            onSelectPath(node.path, "folder");
          }}
          className="group flex w-full items-center gap-1 py-[1px] pr-2 text-left hover:bg-white/[0.04]"
          style={{ paddingLeft: depth * 8 + 4 }}
        >
          {isCollapsed ? <ChevronRight size={14} className="shrink-0 text-[#858585]" />
            : <ChevronDown size={14} className="shrink-0 text-[#858585]" />}
          {isCollapsed ? <Folder size={14} className="shrink-0 text-[#c09553]" />
            : <FolderOpen size={14} className="shrink-0 text-[#c09553]" />}
          <span className="truncate text-[#cccccc] group-hover:text-white">{node.name}</span>
        </button>
        {!isCollapsed && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path} node={child} depth={depth + 1}
                collapsed={collapsed} onToggle={onToggle}
                activePath={activePath}
                selectedPath={selectedPath}
                onOpenFile={onOpenFile}
                onSelectPath={onSelectPath}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const { Icon, color } = iconFor(node.name);
  return (
    <button
      onClick={() => {
        onSelectPath(node.path, "file");
        onOpenFile(node.name, node.path);
      }}
      className={cn(
        "group relative flex w-full items-center gap-1.5 py-[1px] pr-2 text-left transition-colors",
        isActive ? "bg-[#37373d]" : isSelected ? "bg-white/[0.04]" : "hover:bg-white/[0.04]",
      )}
      style={{ paddingLeft: depth * 8 + 22 }}
    >
      <Icon size={14} className="shrink-0" style={{ color }} />
      <span className={cn("truncate", isActive ? "text-white" : "text-[#cccccc] group-hover:text-white")}>
        {node.name}
      </span>
      {node.badge && (
        <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-[#e2c08d]">{node.badge}</span>
      )}
    </button>
  );
}

/* ============================================================
   ModelSelector
   ============================================================ */
const builtInModels: AlphaModel[] = [
  { id: "glm-4.6-coder", name: "GLM-4.6 Coder", description: "Best for code edits & agentic tasks", badge: "Default", Icon: Zap },
  { id: "glm-4.6v", name: "GLM-4.6V", description: "Vision-capable, screenshots & UI", Icon: Sparkles },
  { id: "glm-4.5-air", name: "GLM-4.5 Air", description: "Fastest, lighter reasoning", Icon: Cpu },
  { id: "glm-4-plus", name: "GLM-4 Plus", description: "Long-context, deep reasoning", Icon: Brain },
];

function LegacyModelSelector({ current, onChange }: { current: string; onChange: (id: string) => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [customId, setCustomId] = useState("");
  const [models, setModels] = useState<AlphaModel[]>(builtInModels);
  const currentModel = models.find((m) => m.id === current) ?? models[0];

  return (
    <Popover onOpenChange={(open) => { if (!open) { setShowAdd(false); setCustomId(""); } }}>
      <PopoverTrigger asChild>
        <button
          className="flex h-6 max-w-[160px] items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-[#cccccc] transition-colors hover:bg-white/[0.08]"
          title="Switch model"
        >
          <Sparkles size={11} className="shrink-0 text-[#10b981]" />
          <span className="truncate">{currentModel.name}</span>
          <ChevronDown size={11} className="shrink-0 text-[#858585]" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start" sideOffset={6} collisionPadding={8}
        className="w-[280px] border-[#454545] bg-[#252526] p-0 text-[#cccccc]"
      >
        <div className="flex items-center justify-between border-b border-[#3c3c3c] px-3 py-2">
          <span className="text-[11px] font-semibold tracking-wide text-[#cccccc]">Select model</span>
        </div>
        <div className="alpha-scroll-thin max-h-72 overflow-y-auto py-1">
          {models.map((m) => {
            const Icon = m.Icon;
            const isActive = m.id === current;
            return (
              <button
                key={m.id}
                onClick={() => onChange(m.id)}
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors",
                  isActive ? "bg-[#37373d]" : "hover:bg-[#2a2d2e]",
                )}
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#1e1e1e] ring-1 ring-[#3c3c3c]">
                  <Icon size={13} className="text-[#4daafc]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12px] font-medium text-[#cccccc]">{m.name}</span>
                    {m.badge && (
                      <span className="shrink-0 rounded-sm bg-[#007acc]/30 px-1 text-[9px] font-bold uppercase tracking-wide text-[#4daafc]">{m.badge}</span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-[#858585]">{m.description}</div>
                </div>
                {isActive && <Check size={13} className="mt-1 shrink-0 text-[#10b981]" />}
              </button>
            );
          })}
        </div>
        <div className="border-t border-[#3c3c3c]">
          {showAdd ? (
            <div className="p-2">
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[#858585]">Add a custom model</div>
              <input
                autoFocus value={customId}
                onChange={(e) => setCustomId(e.target.value)}
                placeholder="e.g. my-org/finetuned-coder"
                className="w-full rounded-md border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1 text-[11.5px] text-[#cccccc] placeholder:text-[#6a6a6a] focus:border-[#007acc] focus:outline-none"
              />
              <div className="mt-1.5 flex justify-end gap-1">
                <button onClick={() => { setShowAdd(false); setCustomId(""); }}
                  className="rounded px-2 py-0.5 text-[11px] text-[#858585] hover:bg-white/5 hover:text-[#cccccc]">Cancel</button>
                <button
                  disabled={!customId.trim()}
                  onClick={() => {
                    const id = customId.trim();
                    setModels((prev) => [...prev, { id, name: id.split("/").pop() ?? id, description: "Custom model", Icon: Cpu }]);
                    onChange(id);
                    setCustomId("");
                    setShowAdd(false);
                  }}
                  className="rounded bg-[#007acc] px-2 py-0.5 text-[11px] font-medium text-white hover:bg-[#1a8ad4] disabled:opacity-40"
                >Add</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAdd(true)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#cccccc] hover:bg-[#2a2d2e]">
              <Plus size={13} className="text-[#10b981]" /> Add model…
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ============================================================
   AccessLevelSelector
   ============================================================ */
const accessLevels: Record<AccessLevel, {
  label: string; short: string; Icon: LucideIcon;
  color: string; bg: string; ring: string; desc: string; perms: string[];
}> = {
  ask: {
    label: "Ask for approve", short: "Ask", Icon: Shield,
    color: "text-[#e2c08d]", bg: "bg-[#e2c08d]/15", ring: "ring-[#e2c08d]/40",
    desc: "ALPHA asks before any file change or command.",
    perms: ["Read files", "Suggest diffs", "No auto-apply"],
  },
  safe: {
    label: "Safe approve", short: "Safe", Icon: ShieldCheck,
    color: "text-[#4daafc]", bg: "bg-[#4daafc]/15", ring: "ring-[#4daafc]/40",
    desc: "ALPHA can edit open files; asks for shell & outside paths.",
    perms: ["Edit open files", "Run safe commands", "Ask for installs"],
  },
  full: {
    label: "Full access", short: "Full", Icon: ShieldAlert,
    color: "text-[#f48771]", bg: "bg-[#f48771]/15", ring: "ring-[#f48771]/40",
    desc: "ALPHA can run any command, write any file, install packages.",
    perms: ["Write any file", "Run any command", "Install packages"],
  },
};

function LegacyAccessLevelSelector({ current, onChange }: { current: AccessLevel; onChange: (lvl: AccessLevel) => void }) {
  const lvl = accessLevels[current];
  const Icon = lvl.Icon;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex h-6 max-w-[120px] items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-[#cccccc] transition-colors hover:bg-white/[0.08]"
          title="Agent permissions"
        >
          <Icon size={11} className={cn("shrink-0", lvl.color)} />
          <span className="truncate">{lvl.short}</span>
          <ChevronDown size={11} className="shrink-0 text-[#858585]" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end" sideOffset={6} collisionPadding={8}
        className="w-[300px] border-[#454545] bg-[#252526] p-0 text-[#cccccc]"
      >
        <div className="flex items-center justify-between border-b border-[#3c3c3c] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Lock size={12} className="text-[#cccccc]" />
            <span className="text-[11px] font-semibold tracking-wide text-[#cccccc]">Agent access</span>
          </div>
        </div>
        <div className="p-1.5">
          {(Object.keys(accessLevels) as AccessLevel[]).map((key) => {
            const item = accessLevels[key];
            const ItemIcon = item.Icon;
            const isActive = key === current;
            return (
              <button
                key={key}
                onClick={() => onChange(key)}
                className={cn(
                  "mb-1 flex w-full items-start gap-2.5 rounded-md p-2 text-left transition-colors last:mb-0",
                  isActive ? cn(item.bg, "ring-1", item.ring) : "hover:bg-[#2a2d2e]",
                )}
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#1e1e1e] ring-1 ring-[#3c3c3c]">
                  <ItemIcon size={13} className={item.color} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold text-[#cccccc]">{item.label}</span>
                    {isActive && <Check size={12} className={cn("shrink-0", item.color)} />}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-[#969696]">{item.desc}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {item.perms.map((p) => (
                      <span key={p} className="rounded-sm bg-[#1e1e1e] px-1.5 py-0.5 text-[9.5px] text-[#969696]">{p}</span>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="border-t border-[#3c3c3c] px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-[#858585]">Current scope</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ScopeChip icon={Folder} label="ALPHA-MAIN" />
            <ScopeChip icon={FileText} label="alpha.tsx" />
            <ScopeChip icon={TerminalIcon} label="bash" />
            <ScopeChip icon={Globe} label="network" muted />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ScopeChip({ icon: Icon, label, muted }: { icon: LucideIcon; label: string; muted?: boolean }) {
  return (
    <span className={cn(
      "flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px]",
      muted ? "border-[#3c3c3c] bg-[#1e1e1e] text-[#6a6a6a] line-through" : "border-[#3c3c3c] bg-[#1e1e1e] text-[#cccccc]",
    )}>
      <Icon size={10} className={muted ? "text-[#6a6a6a]" : "text-[#4daafc]"} />
      {label}
    </span>
  );
}

/* ============================================================
   CodingAgent (fresh empty state)
   ============================================================ */
const agentModes: { id: Mode; label: string; Icon: typeof Code2 }[] = [
  { id: "agent", label: "Agent", Icon: Sparkles },
  { id: "edit", label: "Edit", Icon: Code2 },
  { id: "build", label: "Build", Icon: Wrench },
];

const quickActions = [
  { label: "Explain selected code", Icon: BookOpen, hint: "⌘E" },
  { label: "Find bugs in this file", Icon: Bug, hint: "⌘B" },
  { label: "Generate unit tests", Icon: TestTube, hint: "⌘T" },
  { label: "Refactor selection", Icon: FileSearch, hint: "⌘R" },
];

function LegacyCodingAgent() {
  const [mode, setMode] = useState<Mode>("agent");
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string>("glm-4.6-coder");
  const [access, setAccess] = useState<AccessLevel>("safe");

  return (
    <div className="flex h-full flex-col bg-[#252526] text-[#cccccc]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#1f1f1f] px-3">
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className="text-[#10b981]" />
          <span className="text-[11px] font-semibold tracking-[0.14em] text-[#cccccc]">CODING AGENT</span>
        </div>
        <div className="flex items-center gap-0.5">
          <IconBtn title="New chat"><Plus size={14} /></IconBtn>
          <IconBtn title="History"><History size={14} /></IconBtn>
          <IconBtn title="More"><MoreHorizontal size={14} /></IconBtn>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 px-3 py-2">
        {agentModes.map((m) => {
          const Icon = m.Icon;
          const isActive = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                isActive ? "bg-[#10b981]/15 text-[#10b981] ring-1 ring-[#10b981]/30"
                  : "text-[#858585] hover:bg-white/[0.05] hover:text-[#cccccc]",
              )}
            >
              <Icon size={12} /> {m.label}
            </button>
          );
        })}
      </div>
      <div className="alpha-scroll-thin flex-1 overflow-y-auto px-3 pb-3">
        <div className="flex flex-col items-center justify-center px-3 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#10b981]/15 ring-1 ring-[#10b981]/30">
            <Bot size={22} className="text-[#10b981]" />
          </div>
          <div className="mt-3 text-[14px] font-semibold text-[#ffffff]">Start a new session</div>
          <div className="mt-1 max-w-[260px] text-[11.5px] leading-relaxed text-[#858585]">
            Ask ALPHA to build features, refactor code, or run tasks.
            Mention files with @ and attach context to ground the agent.
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="px-1 text-[10px] uppercase tracking-wider text-[#6a6a6a]">Quick actions</div>
          {quickActions.map((q, i) => {
            const Icon = q.Icon;
            return (
              <button
                key={i}
                onClick={() => setInput(q.label)}
                className="flex w-full items-center gap-2 rounded-md border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1.5 text-left text-[12px] text-[#cccccc] hover:border-[#10b981]/30 hover:bg-[#10b981]/[0.04]"
              >
                <Icon size={13} className="shrink-0 text-[#10b981]" />
                <span className="flex-1 truncate">{q.label}</span>
                <kbd className="rounded bg-[#252526] px-1 py-0.5 text-[9px] text-[#6a6a6a]">{q.hint}</kbd>
              </button>
            );
          })}
        </div>
        <div className="mt-4 rounded-md border border-[#3c3c3c] bg-[#1e1e1e] p-2.5 text-[11px] text-[#858585]">
          <div className="mb-1 font-semibold text-[#cccccc]">Tips</div>
          <div className="space-y-1">
            <div>· Press <kbd className="rounded bg-[#252526] px-1">@</kbd> to mention a file or symbol</div>
            <div>· Press <kbd className="rounded bg-[#252526] px-1">/</kbd> to use a slash command</div>
            <div>· Drag screenshots directly into the composer</div>
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-[#1f1f1f] px-3 pb-3 pt-2">
        <div className="rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-2 shadow-inner">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask ALPHA to ${mode === "agent" ? "build something" : mode === "edit" ? "edit code" : "run a task"}…`}
            rows={2}
            className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-[#cccccc] placeholder:text-[#6a6a6a] focus:outline-none"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <IconBtn title="Attach file"><Paperclip size={13} /></IconBtn>
              <IconBtn title="Mention"><AtSign size={13} /></IconBtn>
            </div>
            <button
              disabled={!input.trim()}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                input.trim() ? "bg-[#10b981] text-black hover:bg-[#34d399]" : "bg-white/[0.05] text-[#6a6a6a]",
              )}
            >
              <ArrowUp size={14} strokeWidth={2.4} />
            </button>
          </div>
        </div>
        <div className="mt-2 flex h-7 items-center justify-between gap-1">
          <LegacyModelSelector current={model} onChange={setModel} />
          <div className="flex items-center gap-1">
            <span className="h-3 w-px bg-[#3c3c3c]" />
            <LegacyAccessLevelSelector current={access} onChange={setAccess} />
            <span className="h-3 w-px bg-[#3c3c3c]" />
            <button
              className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-[#858585] transition-colors hover:bg-white/[0.08] hover:text-[#cccccc]"
              title="Work locally"
            >
              <Monitor size={11} /> Local <ChevronDown size={11} />
            </button>
            <button
              className="flex h-6 w-6 items-center justify-center rounded-md text-[#858585] transition-colors hover:bg-white/[0.08] hover:text-[#cccccc]"
              title="Comment"
            >
              <MessageSquare size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <button
      title={title}
      className="rounded p-1 text-[#858585] transition-colors hover:bg-white/[0.06] hover:text-[#cccccc]"
    >
      {children}
    </button>
  );
}

function ModelSelector({
  options,
  currentId,
  onChange,
}: {
  options: BuilderModelOption[]
  currentId: string
  onChange: (id: string) => void
}) {
  const currentModel = options.find((item) => item.id === currentId) ?? options[0];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex h-6 max-w-[170px] items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-[#cccccc] transition-colors hover:bg-white/[0.08]"
          title="Switch model"
        >
          <Sparkles size={11} className="shrink-0 text-[#10b981]" />
          <span className="truncate">{currentModel?.name ?? "Model"}</span>
          <ChevronDown size={11} className="shrink-0 text-[#858585]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} collisionPadding={8} className="w-[320px] border-[#454545] bg-[#252526] p-0 text-[#cccccc]">
        <div className="border-b border-[#3c3c3c] px-3 py-2 text-[11px] font-semibold tracking-wide text-[#cccccc]">Select model</div>
        <div className="alpha-scroll-thin max-h-80 overflow-y-auto py-1">
          {options.map((model) => {
            const isActive = model.id === currentId;
            return (
              <button
                key={model.id}
                onClick={() => onChange(model.id)}
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors",
                  isActive ? "bg-[#37373d]" : "hover:bg-[#2a2d2e]",
                )}
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#1e1e1e] ring-1 ring-[#3c3c3c]">
                  <Cpu size={13} className={model.configured ? "text-[#4daafc]" : "text-[#858585]"} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12px] font-medium text-[#cccccc]">{model.name}</span>
                    {!model.configured && (
                      <span className="shrink-0 rounded-sm bg-[#f48771]/20 px-1 text-[9px] font-bold uppercase tracking-wide text-[#f48771]">
                        Setup
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-[#858585]">{model.description}</div>
                </div>
                {isActive && <Check size={13} className="mt-1 shrink-0 text-[#10b981]" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AccessLevelSelector({
  current,
  onChange,
  workspaceName,
  activeFileName,
}: {
  current: AccessLevel
  onChange: (lvl: AccessLevel) => void
  workspaceName: string
  activeFileName?: string
}) {
  const lvl = accessLevels[current];
  const Icon = lvl.Icon;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex h-6 max-w-[120px] items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-[#cccccc] transition-colors hover:bg-white/[0.08]"
          title="Agent permissions"
        >
          <Icon size={11} className={cn("shrink-0", lvl.color)} />
          <span className="truncate">{lvl.short}</span>
          <ChevronDown size={11} className="shrink-0 text-[#858585]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} collisionPadding={8} className="w-[300px] border-[#454545] bg-[#252526] p-0 text-[#cccccc]">
        <div className="flex items-center gap-1.5 border-b border-[#3c3c3c] px-3 py-2">
          <Lock size={12} className="text-[#cccccc]" />
          <span className="text-[11px] font-semibold tracking-wide text-[#cccccc]">Agent access</span>
        </div>
        <div className="p-1.5">
          {(Object.keys(accessLevels) as AccessLevel[]).map((key) => {
            const item = accessLevels[key];
            const ItemIcon = item.Icon;
            const isActive = key === current;
            return (
              <button
                key={key}
                onClick={() => onChange(key)}
                className={cn(
                  "mb-1 flex w-full items-start gap-2.5 rounded-md p-2 text-left transition-colors last:mb-0",
                  isActive ? cn(item.bg, "ring-1", item.ring) : "hover:bg-[#2a2d2e]",
                )}
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#1e1e1e] ring-1 ring-[#3c3c3c]">
                  <ItemIcon size={13} className={item.color} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold text-[#cccccc]">{item.label}</span>
                    {isActive && <Check size={12} className={cn("shrink-0", item.color)} />}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-[#969696]">{item.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="border-t border-[#3c3c3c] px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-[#858585]">Current scope</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ScopeChip icon={Folder} label={workspaceName} />
            {activeFileName ? <ScopeChip icon={FileText} label={activeFileName} /> : null}
            <ScopeChip icon={TerminalIcon} label="workspace shell" />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CodingAgent({
  messages,
  input,
  onInputChange,
  onSend,
  onStop,
  running,
  selectedModelId,
  modelOptions,
  onModelChange,
  access,
  onAccessChange,
  workspaceName,
  activeFileName,
}: {
  messages: AgentMessage[]
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  running: boolean
  selectedModelId: string
  modelOptions: BuilderModelOption[]
  onModelChange: (id: string) => void
  access: AccessLevel
  onAccessChange: (level: AccessLevel) => void
  workspaceName: string
  activeFileName?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  return (
    <div className="flex h-full flex-col bg-[#252526] text-[#cccccc]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#1f1f1f] px-3">
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className="text-[#10b981]" />
          <span className="text-[11px] font-semibold tracking-[0.14em] text-[#cccccc]">CODING AGENT</span>
        </div>
      </div>
      <div ref={scrollRef} className="alpha-scroll-thin flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3 text-center text-[12px] leading-relaxed text-[#858585]">
            Start with a coding request, normal chat, or explain prompt. Files will only change for real coding actions.
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => (
              <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[88%] text-[12.5px] leading-relaxed",
                    message.role === "user"
                      ? "rounded-2xl border border-[#31508a] bg-[#1f335f] px-3 py-2 text-white shadow-[0_10px_30px_rgba(12,24,54,0.28)]"
                      : message.error
                        ? "rounded-xl border border-[#5c2b2b] bg-[#2a1616] px-3 py-2 text-[#fca5a5]"
                        : message.role === "status"
                          ? cn(
                              "rounded-xl px-0 py-1 text-[#a1a1aa]",
                              message.tone === "success" && "text-[#c7d2fe]",
                              message.tone === "cancelled" && "text-[#fca5a5]"
                            )
                          : "rounded-xl px-0 py-1 text-[#d4d4d4]",
                  )}
                >
                  <div className={cn("whitespace-pre-wrap", message.role !== "user" && "pr-4")}>
                    {message.loading ? (
                      <span className="inline-flex items-center gap-2 text-[#a1a1aa]">
                        <RefreshCw size={12} className="animate-spin" />
                        <span>Thinking...</span>
                      </span>
                    ) : (
                      message.content
                    )}
                  </div>
                  <div className={cn("mt-1 text-[10px] text-[#858585]", message.role !== "user" && "pl-0.5")}>
                    {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {message.providerLabel ? ` · ${message.providerLabel}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-[#1f1f1f] px-3 pb-3 pt-2">
        <div className="rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-2 shadow-inner">
          <textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey || !event.shiftKey)) {
                event.preventDefault();
                if (running) {
                  onStop();
                } else if (input.trim()) {
                  onSend();
                }
              }
            }}
            placeholder="Ask ALPHA Builder to code, edit, explain, or chat…"
            rows={3}
            className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-[#cccccc] placeholder:text-[#6a6a6a] focus:outline-none"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <IconBtn title="Attach file"><Paperclip size={13} /></IconBtn>
              <IconBtn title="Mention"><AtSign size={13} /></IconBtn>
            </div>
            {running ? (
              <button onClick={onStop} className="flex h-6 items-center gap-1 rounded-md bg-[#f48771] px-2 text-[11px] font-medium text-black">
                <X size={12} /> Stop
              </button>
            ) : (
              <button
                disabled={!input.trim()}
                onClick={onSend}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                  input.trim() ? "bg-[#10b981] text-black hover:bg-[#34d399]" : "bg-white/[0.05] text-[#6a6a6a]",
                )}
              >
                <ArrowUp size={14} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
        <div className="mt-2 flex h-7 items-center justify-between gap-1">
          <ModelSelector options={modelOptions} currentId={selectedModelId} onChange={onModelChange} />
          <div className="flex items-center gap-1">
            <span className="h-3 w-px bg-[#3c3c3c]" />
            <AccessLevelSelector current={access} onChange={onAccessChange} workspaceName={workspaceName} activeFileName={activeFileName} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   TabBar
   ============================================================ */
function TabBar({
  tabs, activeTab, mode, onSelect, onClose, onModeChange,
}: {
  tabs: OpenTab[];
  activeTab: string;
  mode: EditorMode;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onModeChange: (m: EditorMode) => void;
}) {
  return (
    <div className="flex h-9 items-stretch border-b border-black/40 bg-[#252526]">
      <div className="flex items-center gap-0.5 pl-1 pr-1">
        <button className="rounded p-1 text-[#858585] hover:bg-white/[0.06] hover:text-[#cccccc]"><ChevronLeft size={14} /></button>
        <button className="rounded p-1 text-[#858585] hover:bg-white/[0.06] hover:text-[#cccccc]"><ChevronRight size={14} /></button>
      </div>
      <div className="alpha-scroll-thin flex flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.path === activeTab;
          const langIcon = tab.name.endsWith(".tsx") ? "TSX" : tab.name.endsWith(".ts") ? "TS" : tab.name.endsWith(".json") ? "{}" : "MD";
          return (
            <button
              key={tab.path}
              onClick={() => onSelect(tab.path)}
              className={cn(
                "group relative flex min-w-0 items-center gap-2 border-r border-black/30 px-3 text-[12.5px] transition-colors",
                isActive ? "bg-[#1e1e1e] text-white" : "bg-[#2d2d2d] text-[#969696] hover:text-[#cccccc]",
              )}
            >
              {isActive && <span className="absolute left-0 top-0 h-[1.5px] w-full bg-[#007acc]" />}
              <span className={cn(
                "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-[7.5px] font-bold",
                langIcon === "TSX" || langIcon === "TS" ? "bg-[#519aba]/20 text-[#519aba]"
                  : langIcon === "{}" ? "bg-[#cbcb41]/20 text-[#cbcb41]"
                  : "bg-white/10 text-[#858585]",
              )}>{langIcon}</span>
              <span className="truncate">{tab.name}</span>
              {tab.dirty && <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#e2c08d]" />}
              <span
                role="button" tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onClose(tab.path); }}
                className={cn(
                  "ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:bg-white/[0.12]",
                  isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
              >
                <X size={12} className={cn("text-[#969696] hover:text-white", tab.dirty ? "hidden group-hover:block" : "block")} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1 border-l border-black/30 bg-[#252526] px-2">
        <ModeToggle active={mode === "code"} onClick={() => onModeChange("code")} icon={Code2} label="Code" />
        <ModeToggle active={mode === "preview"} onClick={() => onModeChange("preview")} icon={Eye} label="Preview" />
        <ModeToggle active={mode === "split"} onClick={() => onModeChange("split")} icon={Columns2} label="Split" />
        <div className="mx-1 h-4 w-px bg-black/30" />
        <button title="More actions" className="rounded p-1.5 text-[#858585] hover:bg-white/[0.06] hover:text-[#cccccc]"><MoreHorizontal size={15} /></button>
        <button title="Split editor" className="rounded p-1.5 text-[#858585] hover:bg-white/[0.06] hover:text-[#cccccc]"><SplitSquareHorizontal size={15} /></button>
      </div>
    </div>
  );
}

function ModeToggle({
  active, onClick, icon: Icon, label,
}: {
  active: boolean; onClick: () => void; icon: typeof Code2; label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium transition-colors",
        active ? "bg-[#007acc]/20 text-[#4daafc] ring-1 ring-[#007acc]/40"
          : "text-[#969696] hover:bg-white/[0.06] hover:text-[#cccccc]",
      )}
    >
      <Icon size={14} strokeWidth={1.8} /> {label}
    </button>
  );
}

/* ============================================================
   Breadcrumbs
   ============================================================ */
function LegacyBreadcrumbs({ path }: { path: string }) {
  const parts = path.split(" / ");
  return (
    <div className="flex h-8 items-center gap-0.5 border-b border-black/40 bg-[#1e1e1e] px-4 text-[12px] text-[#858585]">
      {parts.map((p, i) => {
        const isLast = i === parts.length - 1;
        return (
          <div key={i} className="flex items-center gap-0.5">
            {i > 0 && <ChevronRight size={12} className="text-[#6a6a6a]" />}
            <span className={isLast ? "font-medium text-[#cccccc]" : "hover:text-[#cccccc]"}>{p}</span>
          </div>
        );
      })}
      <div className="ml-auto flex items-center gap-3 text-[11px] text-[#6a6a6a]">
        <span className="flex items-center gap-1"><Check size={11} className="text-[#10b981]" /> Prettier</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" /> No problems</span>
      </div>
    </div>
  );
}

/* ============================================================
   StatusBar
   ============================================================ */
function LegacyStatusBar({ fileName, ln, col }: { fileName: string; ln: number; col: number }) {
  return (
    <div className="flex h-6 items-stretch justify-between bg-[#007acc] text-[11px] text-white">
      <div className="flex items-stretch">
        <StatusItem icon={GitBranch} label="feat/vision-source" />
        <StatusItem icon={Radio} label="0 ↑ 1 ↓" />
        <StatusItem icon={AlertCircle} label="0" />
        <StatusItem icon={Info} label="0" />
      </div>
      <div className="flex items-stretch">
        <StatusItem label="Ln " value={`${ln}, Col ${col}`} />
        <StatusItem label="Spaces: 2" />
        <StatusItem label="UTF-8" />
        <StatusItem label="LF" />
        <StatusItem label="TypeScript JSX" />
        <StatusItem icon={Check} label="Prettier" />
        <StatusItem icon={Sparkles} label="ALPHA AI · Connected" pulse />
        <StatusItem icon={Wifi} />
        <StatusItem icon={Bell} />
      </div>
    </div>
  );
}

function StatusItem({
  icon: Icon, label, value, pulse,
}: {
  icon?: LucideIcon; label?: string; value?: string; pulse?: boolean;
}) {
  return (
    <button className="flex h-full items-center gap-1 px-2 transition-colors hover:bg-white/15">
      {Icon && <Icon size={12} strokeWidth={1.8} className={pulse ? "animate-pulse-soft" : ""} />}
      {label && <span>{label}</span>}
      {value && <span className="opacity-80">{value}</span>}
    </button>
  );
}

function Breadcrumbs({
  path,
  modified,
}: {
  path: string
  modified?: boolean
}) {
  const parts = path.split(" / ");
  return (
    <div className="flex h-8 items-center gap-0.5 border-b border-black/40 bg-[#1e1e1e] px-4 text-[12px] text-[#858585]">
      {parts.map((p, i) => {
        const isLast = i === parts.length - 1;
        return (
          <div key={i} className="flex items-center gap-0.5">
            {i > 0 && <ChevronRight size={12} className="text-[#6a6a6a]" />}
            <span className={isLast ? "font-medium text-[#cccccc]" : "hover:text-[#cccccc]"}>{p}</span>
          </div>
        );
      })}
      <div className="ml-auto flex items-center gap-3 text-[11px] text-[#6a6a6a]">
        {modified && <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#e2c08d]" /> Modified</span>}
        <span className="flex items-center gap-1"><Check size={11} className="text-[#10b981]" /> Workspace Ready</span>
      </div>
    </div>
  );
}

function StatusBar({
  fileName,
  ln,
  col,
  branch,
  language,
  hasWorkspace,
}: {
  fileName: string
  ln: number
  col: number
  branch?: string | null
  language: string
  hasWorkspace: boolean
}) {
  return (
    <div className="flex h-6 items-stretch justify-between bg-[#007acc] text-[11px] text-white">
      <div className="flex items-stretch">
        {branch ? <StatusItem icon={GitBranch} label={branch} /> : <StatusItem icon={Folder} label={hasWorkspace ? "Workspace" : "No Folder"} />}
        <StatusItem icon={Radio} label={hasWorkspace ? "Ready" : "Idle"} />
      </div>
      <div className="flex items-stretch">
        <StatusItem label="Ln " value={`${ln}, Col ${col}`} />
        <StatusItem label="Spaces: 2" />
        <StatusItem label="UTF-8" />
        <StatusItem label="LF" />
        <StatusItem label={language} />
        <StatusItem icon={Check} label={fileName ? "Saved to Disk" : "No File"} />
        <StatusItem icon={Sparkles} label="ALPHA Builder" pulse />
        <StatusItem icon={Wifi} />
        <StatusItem icon={Bell} />
      </div>
    </div>
  );
}

/* ============================================================
   TerminalPanel (with working interactive terminal)
   ============================================================ */
const termTabs: { id: PanelTab; label: string; Icon: typeof AlertCircle; badge?: number }[] = [
  { id: "problems", label: "PROBLEMS", Icon: AlertCircle, badge: 0 },
  { id: "output", label: "OUTPUT", Icon: ListChecks },
  { id: "debug", label: "DEBUG CONSOLE", Icon: Bug },
  { id: "terminal", label: "TERMINAL", Icon: TerminalSquare },
  { id: "ports", label: "PORTS", Icon: Plug, badge: 1 },
];

type TermLine =
  | { kind: "prompt"; cwd: string; cmd: string }
  | { kind: "out"; text: string; tone?: "default" | "dim" | "ok" | "warn" | "err" | "accent" }
  | { kind: "blank" };

const initialLines: TermLine[] = [
  { kind: "out", text: "ALPHA Terminal · zsh · 24.06.29", tone: "dim" },
  { kind: "prompt", cwd: "~/ALPHA-MAIN", cmd: "npm run dev" },
  { kind: "out", text: "" },
  { kind: "out", text: "> alpha-main@0.2.0 dev", tone: "default" },
  { kind: "out", text: "> vite", tone: "default" },
  { kind: "out", text: "" },
  { kind: "out", text: "  VITE v5.4.0  ready in 412 ms", tone: "accent" },
  { kind: "out", text: "" },
  { kind: "out", text: "  ➜  Local:   http://localhost:5173/", tone: "ok" },
  { kind: "out", text: "  ➜  Network: use --host to expose", tone: "dim" },
  { kind: "out", text: "" },
  { kind: "out", text: "5:32:14 PM [vite] hmr update /src/renderer/src/UI/alpha.tsx", tone: "dim" },
  { kind: "out", text: "" },
  { kind: "prompt", cwd: "~/ALPHA-MAIN", cmd: "" },
];

function LegacyTerminalPanel({
  onClose, onMinimize, height,
}: {
  onClose: () => void;
  onMinimize: () => void;
  height: number;
}) {
  const [activeTab, setActiveTab] = useState<PanelTab>("terminal");
  const [lines, setLines] = useState<TermLine[]>(initialLines);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  useEffect(() => {
    if (activeTab === "terminal") inputRef.current?.focus();
  }, [activeTab]);

  function runCommand(cmd: string) {
    if (!cmd.trim()) return;
    const newLines: TermLine[] = [
      ...lines.slice(0, -1),
      { kind: "prompt", cwd: "~/ALPHA-MAIN", cmd },
    ];
    const c = cmd.trim().toLowerCase();
    if (c === "clear" || c === "cls") {
      setLines([
        { kind: "out", text: "ALPHA Terminal · zsh · 24.06.29", tone: "dim" },
        { kind: "prompt", cwd: "~/ALPHA-MAIN", cmd: "" },
      ]);
      setInput("");
      return;
    }
    if (c === "ls" || c === "dir") {
      newLines.push({ kind: "out", text: "ALPHA-MAIN/  package.json  vite.config.ts  tsconfig.json  README.md  src/  public/" });
    } else if (c.startsWith("cd ")) {
      newLines.push({ kind: "prompt", cwd: cmd.slice(3).trim() || "~/ALPHA-MAIN", cmd: "" });
      setLines(newLines);
      setInput("");
      return;
    } else if (c === "pwd") {
      newLines.push({ kind: "out", text: "/home/z/ALPHA-MAIN" });
    } else if (c === "npm run dev" || c === "yarn dev" || c === "pnpm dev") {
      newLines.push(
        { kind: "out", text: "" },
        { kind: "out", text: "  VITE v5.4.0  ready in 312 ms", tone: "accent" },
        { kind: "out", text: "  ➜  Local:   http://localhost:5173/", tone: "ok" },
      );
    } else if (c === "git status") {
      newLines.push(
        { kind: "out", text: "On branch feat/vision-source", tone: "default" },
        { kind: "out", text: "Changes not staged for commit:" },
        { kind: "out", text: "  modified:   src/renderer/src/UI/alpha.tsx", tone: "warn" },
        { kind: "out", text: "  modified:   src/renderer/src/views/builderwindow.tsx", tone: "warn" },
        { kind: "out", text: "  modified:   src/renderer/src/store/visionStore.ts", tone: "warn" },
      );
    } else if (c === "git log --oneline -5") {
      newLines.push(
        { kind: "out", text: "f7e6b0a feat: add screen-share source to Alpha", tone: "accent" },
        { kind: "out", text: "9c4d1e3 refactor: extract SourcePicker modal" },
        { kind: "out", text: "3a2b8c1 chore: bump vite to 5.4.0" },
        { kind: "out", text: "1f0a9d2 fix: vision store hydration" },
        { kind: "out", text: "a8b7c6e feat: neural processing pipeline" },
      );
    } else if (c === "help" || c === "?") {
      newLines.push(
        { kind: "out", text: "ALPHA terminal — supported commands:", tone: "accent" },
        { kind: "out", text: "  ls / dir            list files" },
        { kind: "out", text: "  pwd                 print working dir" },
        { kind: "out", text: "  cd <path>           change directory" },
        { kind: "out", text: "  clear / cls         clear screen" },
        { kind: "out", text: "  npm run dev         start dev server" },
        { kind: "out", text: "  git status          git status" },
        { kind: "out", text: "  git log --oneline -5   recent commits" },
      );
    } else {
      newLines.push({ kind: "out", text: `zsh: command not found: ${cmd.split(" ")[0]}`, tone: "err" });
    }
    newLines.push({ kind: "out", text: "" });
    newLines.push({ kind: "prompt", cwd: "~/ALPHA-MAIN", cmd: "" });
    setLines(newLines);
    setInput("");
  }

  return (
    <div className="flex shrink-0 flex-col border-t border-[#2b2b2b] bg-[#1e1e1e]" style={{ height }}>
      <div className="flex h-9 items-stretch border-b border-[#2b2b2b] pr-2">
        <div className="flex flex-1 items-stretch">
          {termTabs.map((t) => {
            const Icon = t.Icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 border-r border-[#2b2b2b] px-3 text-[11px] font-medium tracking-wider transition-colors",
                  isActive ? "bg-[#1e1e1e] text-[#ffffff]" : "text-[#858585] hover:bg-white/[0.04] hover:text-[#cccccc]",
                )}
              >
                <Icon size={12} className={isActive ? "text-[#cccccc]" : "text-[#6a6a6a]"} />
                {t.label}
                {t.badge !== undefined && t.badge > 0 && (
                  <span className="ml-0.5 rounded-full bg-[#007acc] px-1 text-[9px] text-white">{t.badge}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          {activeTab === "terminal" && (
            <>
              <button className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#cccccc] hover:bg-white/[0.06]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" /> zsh
                <ChevronDown size={11} className="text-[#858585]" />
              </button>
              <button className="rounded p-1 text-[#858585] hover:bg-white/[0.06] hover:text-[#cccccc]" title="New Terminal"><Plus size={14} /></button>
              <button className="rounded p-1 text-[#858585] hover:bg-white/[0.06] hover:text-[#cccccc]" title="Split Terminal"><SplitSquareHorizontal size={14} /></button>
              <button className="rounded p-1 text-[#858585] hover:bg-white/[0.06] hover:text-[#cccccc]" title="Kill Terminal"><X size={14} /></button>
              <div className="mx-1 h-4 w-px bg-[#2b2b2b]" />
            </>
          )}
          <button onClick={onMinimize} className="rounded p-1 text-[#858585] hover:bg-white/[0.06] hover:text-[#cccccc]" title="Minimize"><ChevronDown size={14} /></button>
          <button onClick={onClose} className="rounded p-1 text-[#858585] hover:bg-white/[0.06] hover:text-[#cccccc]" title="Close"><X size={14} /></button>
        </div>
      </div>
      <div className="alpha-scroll-thin flex-1 overflow-y-auto p-2 font-mono text-[12.5px] leading-[1.5]">
        {activeTab === "terminal" && (
          <LegacyTerminalBody
            lines={lines} input={input} setInput={setInput}
            runCommand={runCommand} scrollRef={scrollRef} inputRef={inputRef}
          />
        )}
        {activeTab === "problems" && (
          <div className="text-[12px] text-[#858585]">No problems have been detected in the workspace.</div>
        )}
        {activeTab === "output" && (
          <div className="space-y-0.5 text-[12px] leading-[1.5]">
            <div className="text-[#858585]">[Info  - 5:32:14 PM] VITE — HMR update /src/renderer/src/UI/alpha.tsx</div>
            <div className="text-[#858585]">[Info  - 5:32:25 PM] ALPHA Agent — applied diff to alpha.tsx (12 lines)</div>
            <div className="text-[#73c991]">[Info  - 5:32:25 PM] ALPHA Agent — lint check passed, 0 errors</div>
          </div>
        )}
        {activeTab === "debug" && (
          <div className="space-y-2 text-[12px] text-[#858585]">
            <div className="text-[#cccccc]">⏵ Start Debugging (F5) to begin a session.</div>
          </div>
        )}
        {activeTab === "ports" && (
          <div className="space-y-1 text-[12px]">
            <div className="grid grid-cols-4 gap-2 border-b border-[#2b2b2b] pb-1 text-[10px] uppercase tracking-wider text-[#6a6a6a]">
              <div>Port</div><div>Process</div><div>Forwarded</div><div>Visibility</div>
            </div>
            <div className="grid grid-cols-4 gap-2 py-1 text-[#cccccc]">
              <div className="font-mono text-[#4daafc]">5173</div><div>vite</div>
              <div className="text-[#73c991]">localhost:5173</div><div>Private</div>
            </div>
            <div className="grid grid-cols-4 gap-2 py-1 text-[#cccccc]">
              <div className="font-mono text-[#4daafc]">3000</div><div>next-server</div>
              <div className="text-[#73c991]">localhost:3000</div><div>Private</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LegacyTerminalBody({
  lines, input, setInput, runCommand, scrollRef, inputRef,
}: {
  lines: TermLine[];
  input: string;
  setInput: (v: string) => void;
  runCommand: (cmd: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div ref={scrollRef} className="min-h-full">
      {lines.map((l, i) => {
        if (l.kind === "blank") return <div key={i} className="h-[18px]" />;
        if (l.kind === "out") {
          const tone =
            l.tone === "ok" ? "text-[#73c991]"
            : l.tone === "warn" ? "text-[#e2c08d]"
            : l.tone === "err" ? "text-[#f48771]"
            : l.tone === "accent" ? "text-[#4daafc]"
            : l.tone === "dim" ? "text-[#6a6a6a]"
            : "text-[#cccccc]";
          return <div key={i} className={`whitespace-pre-wrap ${tone}`}>{l.text || "\u00a0"}</div>;
        }
        const isLast = i === lines.length - 1;
        return (
          <div key={i} className="flex items-center">
            <span className="text-[#73c991]">{l.cwd}</span>
            <span className="mx-1 text-[#858585]">❯</span>
            {!isLast && <span className="text-[#cccccc]">{l.cmd}</span>}
            {isLast && (
              <span className="flex flex-1 items-center">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runCommand(input); }}
                  className="flex-1 bg-transparent text-[#cccccc] caret-[#aeafad] focus:outline-none"
                  spellCheck={false} autoComplete="off"
                />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   FunctionalCodeEditor (editable + autocomplete)
   ============================================================ */
const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "do", "switch", "case", "break", "continue", "default", "import", "from",
  "export", "class", "extends", "implements", "interface", "type", "enum",
  "namespace", "public", "private", "protected", "readonly", "static",
  "async", "await", "yield", "new", "delete", "typeof", "instanceof", "in",
  "of", "as", "is", "keyof", "infer", "true", "false", "null", "undefined",
  "void", "this", "super", "throw", "try", "catch", "finally",
]);

const BUILTINS = new Set([
  "useState", "useEffect", "useRef", "useMemo", "useCallback", "useContext",
  "useReducer", "console", "window", "document", "Math", "JSON", "Object",
  "Array", "String", "Number", "Boolean", "Promise", "Date", "Map", "Set",
]);

type Tok = { text: string; cls: string };

function tokenizeLine(line: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i];
    const rest = line.slice(i);
    if (rest.startsWith("//")) { toks.push({ text: rest, cls: "tok-com" }); break; }
    if (ch === " " || ch === "\t") {
      let j = i;
      while (j < n && (line[j] === " " || line[j] === "\t")) j++;
      toks.push({ text: line.slice(i, j), cls: "tok-plain" });
      i = j; continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n && line[j] !== ch) { if (line[j] === "\\") j++; j++; }
      j = Math.min(j + 1, n);
      toks.push({ text: line.slice(i, j), cls: "tok-str" });
      i = j; continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9._xXa-fA-F]/.test(line[j])) j++;
      toks.push({ text: line.slice(i, j), cls: "tok-num" });
      i = j; continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(line[j])) j++;
      const word = line.slice(i, j);
      let cls = "tok-plain";
      if (KEYWORDS.has(word)) cls = "tok-kw";
      else if (BUILTINS.has(word)) cls = "tok-fn";
      else if (/^[A-Z]/.test(word)) cls = "tok-type";
      else if (line[j] === "(") cls = "tok-fn";
      toks.push({ text: word, cls });
      i = j; continue;
    }
    toks.push({ text: ch, cls: "tok-punct" });
    i++;
  }
  return toks;
}

const SUGGESTIONS: Suggestion[] = [
  { label: "const", detail: "keyword", insert: "const ", kind: "kw" },
  { label: "let", detail: "keyword", insert: "let ", kind: "kw" },
  { label: "var", detail: "keyword", insert: "var ", kind: "kw" },
  { label: "function", detail: "keyword", insert: "function ", kind: "kw" },
  { label: "return", detail: "keyword", insert: "return ", kind: "kw" },
  { label: "if", detail: "keyword", insert: "if ", kind: "kw" },
  { label: "else", detail: "keyword", insert: "else ", kind: "kw" },
  { label: "for", detail: "keyword", insert: "for ", kind: "kw" },
  { label: "while", detail: "keyword", insert: "while ", kind: "kw" },
  { label: "import", detail: "keyword", insert: "import ", kind: "kw" },
  { label: "export", detail: "keyword", insert: "export ", kind: "kw" },
  { label: "default", detail: "keyword", insert: "default ", kind: "kw" },
  { label: "class", detail: "keyword", insert: "class ", kind: "kw" },
  { label: "interface", detail: "keyword", insert: "interface ", kind: "kw" },
  { label: "type", detail: "keyword", insert: "type ", kind: "kw" },
  { label: "async", detail: "keyword", insert: "async ", kind: "kw" },
  { label: "await", detail: "keyword", insert: "await ", kind: "kw" },
  { label: "try", detail: "keyword", insert: "try ", kind: "kw" },
  { label: "catch", detail: "keyword", insert: "catch ", kind: "kw" },
  { label: "new", detail: "keyword", insert: "new ", kind: "kw" },
  { label: "useState", detail: "React hook", insert: "useState", kind: "fn" },
  { label: "useEffect", detail: "React hook", insert: "useEffect", kind: "fn" },
  { label: "useRef", detail: "React hook", insert: "useRef", kind: "fn" },
  { label: "useMemo", detail: "React hook", insert: "useMemo", kind: "fn" },
  { label: "useCallback", detail: "React hook", insert: "useCallback", kind: "fn" },
  { label: "useContext", detail: "React hook", insert: "useContext", kind: "fn" },
  { label: "console.log", detail: "function", insert: "console.log", kind: "fn" },
  { label: "console.error", detail: "function", insert: "console.error", kind: "fn" },
  { label: "console.warn", detail: "function", insert: "console.warn", kind: "fn" },
  { label: "useState snippet", detail: "snippet", insert: "const [state, setState] = useState(initialValue);", kind: "snip" },
  { label: "useEffect snippet", detail: "snippet", insert: "useEffect(() => {\n  \n}, []);", kind: "snip" },
  { label: "function snippet", detail: "snippet", insert: "function name(args) {\n  \n}", kind: "snip" },
  { label: "arrow function", detail: "snippet", insert: "const fn = (args) => {\n  \n};", kind: "snip" },
  { label: "interface snippet", detail: "snippet", insert: "interface Name {\n  \n}", kind: "snip" },
  { label: "import react", detail: "snippet", insert: "import React, { useState } from 'react';", kind: "snip" },
];

const buildHtmlStarter = (indent = "") =>
  `${indent}<!DOCTYPE html>
${indent}<html lang="en">
${indent}<head>
${indent}  <meta charset="UTF-8" />
${indent}  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
${indent}  <title>Document</title>
${indent}</head>
${indent}<body>
${indent}  
${indent}</body>
${indent}</html>`;

function FunctionalCodeEditor({
  fileName,
  code,
  onChange,
  onCursorChange,
  fontSize,
  fontFamily,
  wordWrap,
  tabSize,
}: {
  fileName: string
  code: string
  onChange: (next: string) => void
  onCursorChange: (cursor: CursorState) => void
  fontSize: number
  fontFamily: string
  wordWrap: boolean
  tabSize: number
}) {
  const [cursorPos, setCursorPos] = useState(0);
  const [suggestIdx, setSuggestIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorLineHeight = 19.4;
  const isHtmlFile = /\.html?$/i.test(fileName);

  const currentWord = useMemo(() => {
    const upto = code.slice(0, cursorPos);
    const m = upto.match(/[A-Za-z_$][A-Za-z0-9_$]*$/);
    return m ? m[0] : "";
  }, [code, cursorPos]);

  const filtered = useMemo(() => {
    if (!currentWord) return [];
    const w = currentWord.toLowerCase();
    return SUGGESTIONS.filter(
      (s) => s.label.toLowerCase().includes(w) || s.insert.toLowerCase().includes(w),
    ).slice(0, 8);
  }, [currentWord]);

  const showSuggest = currentWord.length >= 2 && filtered.length > 0;
  const safeSuggestIdx = suggestIdx < filtered.length ? suggestIdx : 0;

  const reportCursor = (position: number, nextCode: string) => {
    const upto = nextCode.slice(0, position);
    const parts = upto.split("\n");
    onCursorChange({
      line: parts.length,
      col: (parts.at(-1)?.length ?? 0) + 1,
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    setCursorPos(e.target.selectionStart);
    reportCursor(e.target.selectionStart, e.target.value);
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCursorPos(e.currentTarget.selectionStart);
    reportCursor(e.currentTarget.selectionStart, code);
  };

  const acceptSuggestion = (s: Suggestion) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const before = code.slice(0, cursorPos);
    const after = code.slice(cursorPos);
    const wordStart = before.length - currentWord.length;
    const newCode = code.slice(0, wordStart) + s.insert + after;
    const newCursor = wordStart + s.insert.length;
    onChange(newCode);
    setCursorPos(newCursor);
    reportCursor(newCursor, newCode);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCursor, newCursor);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const before = code.slice(0, start);
      const after = code.slice(end);
      const lineStart = before.lastIndexOf("\n") + 1;
      const nextLineOffset = after.indexOf("\n");
      const lineEnd = nextLineOffset === -1 ? code.length : end + nextLineOffset;
      const lineText = code.slice(lineStart, lineEnd);

      if (isHtmlFile && start === end && lineText.trim() === "!") {
        e.preventDefault();
        const indent = lineText.match(/^\s*/)?.[0] ?? "";
        const snippet = buildHtmlStarter(indent);
        const newCode = `${code.slice(0, lineStart)}${snippet}${code.slice(lineEnd)}`;
        const bodyCursor = `${indent}<body>\n${indent}  `;
        const cursorOffset = snippet.indexOf(bodyCursor);
        const newCursor = lineStart + (cursorOffset >= 0 ? cursorOffset + bodyCursor.length : snippet.length);
        onChange(newCode);
        setCursorPos(newCursor);
        reportCursor(newCursor, newCode);
        requestAnimationFrame(() => {
          ta.focus();
          ta.setSelectionRange(newCursor, newCursor);
        });
        return;
      }
    }

    if (showSuggest && filtered.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSuggestIdx((i) => (i + 1) % filtered.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSuggestIdx((i) => (i - 1 + filtered.length) % filtered.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); acceptSuggestion(filtered[safeSuggestIdx]); return; }
      if (e.key === "Escape") { e.preventDefault(); setSuggestIdx(0); return; }
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const indent = " ".repeat(Math.max(1, tabSize));
      const newCode = code.slice(0, start) + indent + code.slice(end);
      onChange(newCode);
      setCursorPos(start + indent.length);
      reportCursor(start + indent.length, newCode);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + indent.length; });
    }
  };

  const caretCoords = useMemo<{ top: number; left: number } | null>(() => {
    if (!showSuggest) return null;
    const upto = code.slice(0, cursorPos);
    const lineIdx = (upto.match(/\n/g)?.length) ?? 0;
    const lineStart = upto.lastIndexOf("\n") + 1;
    const colInLine = cursorPos - lineStart;
    return { top: lineIdx * editorLineHeight + 16, left: colInLine * 7.2 + 16 };
  }, [showSuggest, code, cursorPos, editorLineHeight]);

  const lines = code.split("\n");
  const editorHeight = Math.max(lines.length, 1) * editorLineHeight + 24;

  return (
    <div
      className="alpha-scroll relative flex h-full w-full overflow-auto bg-[#1e1e1e] leading-[1.55]"
      style={{ fontFamily, fontSize: `${fontSize}px` }}
    >
      <div className="flex min-w-full">
        <div
          className="sticky left-0 z-10 select-none bg-[#1e1e1e] pr-2 pl-3 text-right text-[#858585]"
          style={{ fontFamily, fontSize: `${Math.max(11, fontSize - 0.5)}px` }}
        >
          {lines.map((_, i) => (
            <div key={i} className="leading-[19.4px]" style={{ height: `${editorLineHeight}px` }}>{i + 1}</div>
          ))}
        </div>
        <div className="relative flex-1 pl-2 pr-6">
          <textarea
            ref={textareaRef}
            value={code}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onSelect={handleSelect}
            onClick={handleSelect}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap={wordWrap ? "soft" : "off"}
            data-file-name={fileName}
            aria-label={`Code editor for ${fileName}`}
            className={cn(
              "block w-full resize-none overflow-hidden bg-transparent px-2 py-0 text-[#d4d4d4] selection:bg-[#264f78] selection:text-[#ffffff] focus:outline-none",
              wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
            )}
            style={{
              height: `${editorHeight}px`,
              caretColor: "#d4d4d4",
              fontFamily,
              fontSize: `${fontSize}px`,
              lineHeight: `${editorLineHeight}px`,
              tabSize: tabSize as unknown as number,
            }}
          />
          {showSuggest && filtered.length > 0 && caretCoords && (
            <div
              className="absolute z-50 w-72 animate-fade-in overflow-hidden rounded-md border border-[#454545] bg-[#252526] shadow-2xl"
              style={{ top: caretCoords.top, left: caretCoords.left }}
            >
              <div className="border-b border-[#3c3c3c] px-2 py-1 text-[10px] uppercase tracking-wider text-[#6a6a6a]">Suggestions</div>
              <div className="alpha-scroll-thin max-h-64 overflow-y-auto py-1">
                {filtered.map((s, i) => (
                  <button
                    key={s.label}
                    onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(s); }}
                    onMouseEnter={() => setSuggestIdx(i)}
                    className={`flex w-full items-center gap-2 px-2 py-1 text-left ${i === safeSuggestIdx ? "bg-[#04395e]" : "hover:bg-[#2a2d2e]"}`}
                  >
                    <span className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[8px] font-bold",
                      s.kind === "kw" ? "bg-[#569cd6]/20 text-[#569cd6]"
                      : s.kind === "fn" ? "bg-[#dcdcaa]/20 text-[#dcdcaa]"
                      : s.kind === "snip" ? "bg-[#4ec9b0]/20 text-[#4ec9b0]"
                      : "bg-[#9cdcfe]/20 text-[#9cdcfe]",
                    )}>
                      {s.kind === "kw" ? "K" : s.kind === "fn" ? "ƒ" : s.kind === "snip" ? "S" : "V"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-[#cccccc]">{s.label}</div>
                      <div className="truncate text-[10px] text-[#6a6a6a]">{s.detail}</div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="border-t border-[#3c3c3c] px-2 py-1 text-[9.5px] text-[#6a6a6a]">
                <kbd className="rounded bg-[#1e1e1e] px-1">↑↓</kbd> navigate ·{" "}
                <kbd className="rounded bg-[#1e1e1e] px-1">Tab</kbd> accept ·{" "}
                <kbd className="rounded bg-[#1e1e1e] px-1">Esc</kbd> close
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   LivePreview (phone-shaped preview)
   ============================================================ */
function LegacyLivePreview({ fileName }: { fileName: string }) {
  const [showModal, setShowModal] = useState(true);
  const [pickedSource, setPickedSource] = useState<"camera" | "screen" | null>(null);

  return (
    <div className="alpha-scroll relative flex h-full w-full items-start justify-center gap-6 overflow-auto bg-[#1e1e1e] p-6">
      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-1.5 rounded-md bg-[#252526] px-2 py-1 text-[10px] text-[#858585] ring-1 ring-[#3c3c3c]">
        <span className="h-2 w-2 rounded-full bg-[#f48771]/80" />
        <span className="h-2 w-2 rounded-full bg-[#e2c08d]/80" />
        <span className="h-2 w-2 rounded-full bg-[#73c991]/80" />
        <span className="ml-2 font-mono">localhost:5173 / preview · {fileName}</span>
      </div>
      <div className="absolute right-4 top-4 flex items-center gap-1.5 rounded-md bg-[#252526] px-2 py-1 text-[10px] text-[#73c991] ring-1 ring-[#3c3c3c]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#73c991] animate-pulse-dot" />
        HMR synced
        <Refresh size={9} className="ml-1 opacity-70" />
      </div>
      <div className="mt-10 flex min-w-0 flex-1 justify-center">
        <div className="relative flex h-[600px] w-[320px] shrink-0 flex-col overflow-hidden rounded-[36px] border border-[#3c3c3c] bg-[#0d0d10] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]">
          <div className="relative flex h-7 items-center justify-center">
            <div className="h-1.5 w-16 rounded-full bg-black/80" />
          </div>
          <div className="flex items-center justify-between px-5 pb-1 text-[10px] font-medium text-[#cccccc]">
            <span>9:41</span>
            <div className="flex items-center gap-1">
              <Signal size={10} /><Wifi size={10} /><BatteryFull size={11} />
            </div>
          </div>
          <div className="flex h-12 shrink-0 items-center justify-between px-5 pt-2">
            <div className="min-w-0">
              <div className="truncate text-[9px] font-bold tracking-[0.18em] text-[#6a6a6a]">ALPHA · NEURAL</div>
              <div className="truncate text-[15px] font-semibold text-[#ffffff]">Vision Source</div>
            </div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#10b981]/15 ring-1 ring-[#10b981]/30">
              <Sparkles size={14} className="text-[#10b981]" />
            </div>
          </div>
          <div className="mx-5 mt-2 aspect-[5/4] shrink-0 overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br from-[#1a1a1f] to-[#070708]">
            <div className="relative flex h-full flex-col items-center justify-center">
              <div className="absolute inset-0 opacity-30" style={{
                backgroundImage: "linear-gradient(to right, rgba(16,185,129,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(16,185,129,0.18) 1px, transparent 1px)",
                backgroundSize: "20px 20px",
              }} />
              <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-[#10b981]/15 ring-1 ring-[#10b981]/30">
                {pickedSource === "screen" ? <Monitor size={22} className="text-[#10b981]" />
                  : <Camera size={22} className="text-[#10b981]" />}
              </div>
              <div className="mt-2 text-[9px] font-bold tracking-[0.18em] text-[#10b981]">
                {pickedSource === "screen" ? "SCREEN SHARE" : "CAMERA FEED"}
              </div>
              <div className="mt-0.5 text-[8px] tracking-wider text-[#6a6a6a]">
                NEURAL PROCESSING {pickedSource ? "ACTIVE" : "READY"}
              </div>
              <span className="absolute left-2 top-2 h-2 w-2 border-l border-t border-[#10b981]/60" />
              <span className="absolute right-2 top-2 h-2 w-2 border-r border-t border-[#10b981]/60" />
              <span className="absolute bottom-2 left-2 h-2 w-2 border-b border-l border-[#10b981]/60" />
              <span className="absolute bottom-2 right-2 h-2 w-2 border-b border-r border-[#10b981]/60" />
            </div>
          </div>
          {showModal && (
            <div className="mx-5 mt-3 shrink-0">
              <div className="rounded-2xl border border-[#10b981]/20 bg-[#10b981]/[0.05] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[9px] font-semibold tracking-[0.16em] text-[#969696]">SELECT INPUT SOURCE FOR NEURAL PROCESSING</p>
                  <button onClick={() => setShowModal(false)} className="shrink-0 rounded-md p-0.5 text-[#858585] hover:bg-white/10 hover:text-[#cccccc]"><X size={11} /></button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <button onClick={() => { setPickedSource("camera"); setShowModal(false); }}
                    className="flex flex-col items-center gap-1 rounded-xl border border-[#10b981]/30 bg-[#10b981]/10 py-2.5 text-[#10b981] hover:bg-[#10b981]/15">
                    <Camera size={16} /><span className="text-[9px] font-bold tracking-widest">CAMERA FEED</span>
                  </button>
                  <button onClick={() => { setPickedSource("screen"); setShowModal(false); }}
                    className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] py-2.5 text-[#cccccc] hover:bg-white/[0.06]">
                    <Monitor size={16} /><span className="text-[9px] font-bold tracking-widest">SCREEN SHARE</span>
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="mx-5 mt-3 flex shrink-0 items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#10b981] animate-pulse-dot" />
            <span className="text-[10px] tracking-wider text-[#969696]">{pickedSource ? "STREAM LIVE" : "AWAITING SOURCE"}</span>
            <span className="ml-auto flex items-center gap-1 text-[10px] text-[#969696]"><Mic size={10} className="text-[#10b981]" /> AUDIO</span>
          </div>
          <div className="mx-5 mt-3 shrink-0 space-y-1.5">
            <div className="flex items-center justify-between rounded-lg border border-[#2b2b2b] bg-[#1a1a1f] px-2.5 py-1.5">
              <span className="text-[11px] text-[#cccccc]">Capture frame</span>
              <div className="flex items-center gap-1.5">
                <kbd className="rounded bg-black/40 px-1 py-0.5 font-mono text-[9px] text-[#858585]">⌘+K</kbd>
                <ChevronRight size={11} className="text-[#6a6a6a]" />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-[#2b2b2b] bg-[#1a1a1f] px-2.5 py-1.5">
              <span className="text-[11px] text-[#cccccc]">Run inference</span>
              <div className="flex items-center gap-1.5">
                <kbd className="rounded bg-black/40 px-1 py-0.5 font-mono text-[9px] text-[#858585]">⌘+↵</kbd>
                <ChevronRight size={11} className="text-[#6a6a6a]" />
              </div>
            </div>
          </div>
          <div className="mt-auto px-5 pb-6 pt-3">
            <button className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#10b981] py-2.5 text-[12px] font-semibold text-black shadow-[0_0_24px_rgba(16,185,129,0.4)] hover:bg-[#34d399]">
              <Play size={13} fill="currentColor" /> Start neural capture
            </button>
            <div className="mt-2 text-center text-[9px] tracking-widest text-[#6a6a6a]">ALPHA · v6.0.1 · BUILD 24.06.29</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ExtensionsPanel
   ============================================================ */
type Ext = {
  name: string; publisher: string; description: string;
  installs: string; rating: number; verified?: boolean; installed?: boolean;
  color: string; letter: string;
};

const installedExts: Ext[] = [
  { name: "ALPHA Coder", publisher: "alpha.ai", description: "AI pair programmer — code, refactor, debug with the ALPHA agent.", installs: "2.1M", rating: 4.8, verified: true, installed: true, color: "#10b981", letter: "A" },
  { name: "Prettier — Code formatter", publisher: "Prettier", description: "Code formatter using prettier", installs: "38M", rating: 4.5, verified: true, installed: true, color: "#c596c7", letter: "P" },
  { name: "ESLint", publisher: "Microsoft", description: "Integrates ESLint JavaScript into VS Code.", installs: "31M", rating: 4.4, verified: true, installed: true, color: "#4b32c3", letter: "E" },
  { name: "Tailwind CSS IntelliSense", publisher: "Tailwind Labs", description: "Intelligent Tailwind CSS tooling for VS Code", installs: "8.4M", rating: 4.7, verified: true, installed: true, color: "#06b6d4", letter: "T" },
];

const popularExts: Ext[] = [
  { name: "GitLens — Git supercharged", publisher: "GitKraken", description: "Supercharge Git within VS Code — visualize, blame, explore commits.", installs: "26M", rating: 4.6, verified: true, color: "#6b6b6b", letter: "G" },
  { name: "Python", publisher: "Microsoft", description: "IntelliSense (Pylance), Linting, Debugging, Jupyter Notebooks...", installs: "100M", rating: 4.5, verified: true, color: "#3776ab", letter: "P" },
  { name: "Live Server", publisher: "Ritwick Dey", description: "Launch a development local Server with live reload feature", installs: "43M", rating: 4.4, color: "#f48771", letter: "L" },
  { name: "Docker", publisher: "Microsoft", description: "Makes it easy to create, manage, and debug Docker containers.", installs: "24M", rating: 4.3, verified: true, color: "#2496ed", letter: "D" },
  { name: "Material Icon Theme", publisher: "Philipp Kief", description: "Material Design Icons for Visual Studio Code", installs: "20M", rating: 4.9, color: "#90caf9", letter: "M" },
];

function ExtensionsPanel() {
  const [tab, setTab] = useState<"marketplace" | "installed">("marketplace");
  const [query, setQuery] = useState("");
  const list = tab === "installed" ? installedExts : popularExts;
  const filtered = query
    ? list.filter((e) =>
        e.name.toLowerCase().includes(query.toLowerCase()) ||
        e.publisher.toLowerCase().includes(query.toLowerCase()) ||
        e.description.toLowerCase().includes(query.toLowerCase()))
    : list;

  return (
    <div className="flex h-full flex-col bg-[#252526] text-[#cccccc]">
      <div className="flex h-9 items-center justify-between px-3 pt-2">
        <span className="text-[11px] font-semibold tracking-[0.14em] text-[#cccccc]">EXTENSIONS</span>
        <button title="Views and More Actions" className="rounded p-1 text-[#858585] hover:bg-white/[0.06] hover:text-[#cccccc]"><Settings size={13} /></button>
      </div>
      <div className="px-3 pb-2">
        <div className="flex h-7 items-center gap-1.5 rounded-md border border-[#3c3c3c] bg-[#1e1e1e] px-2 focus-within:border-[#007acc]">
          <Search size={12} className="text-[#858585]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Extensions in Marketplace"
            className="flex-1 bg-transparent text-[12px] text-[#cccccc] placeholder:text-[#6a6a6a] focus:outline-none"
          />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 px-3 pb-2">
        {[{ id: "marketplace" as const, label: "MARKETPLACE" }, { id: "installed" as const, label: "INSTALLED" }].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-semibold tracking-wider transition-colors",
              tab === t.id ? "bg-[#007acc]/20 text-[#4daafc] ring-1 ring-[#007acc]/40"
                : "text-[#858585] hover:bg-white/[0.06] hover:text-[#cccccc]",
            )}
          >{t.label}</button>
        ))}
      </div>
      <div className="alpha-scroll-thin flex-1 overflow-y-auto px-2 pb-3">
        {filtered.length === 0 && (
          <div className="px-2 py-6 text-center text-[12px] text-[#858585]">No matching extensions.</div>
        )}
        {filtered.map((e, i) => (
          <div key={`${e.name}-${i}`} className="group mb-1 rounded-md p-2 hover:bg-white/[0.04]">
            <div className="flex gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[14px] font-bold text-white" style={{ backgroundColor: e.color }}>
                {e.letter}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="truncate text-[12.5px] font-semibold text-[#cccccc] group-hover:text-white">{e.name}</span>
                    {e.verified && (
                      <svg width="11" height="11" viewBox="0 0 16 16" className="shrink-0 fill-[#007acc]">
                        <path d="M8 0L9.79 1.27L12 1L12.73 3.21L14.91 4L14.18 6.21L15.45 8L14.18 9.79L14.91 12L12.73 12.73L12 15L9.79 14.18L8 16L6.21 14.18L4 15L3.27 12.73L1.09 12L1.82 9.79L0.55 8L1.82 6.21L1.09 4L3.27 3.21L4 1L6.21 1.27L8 0Z" />
                        <path d="M5.5 8L7 9.5L10.5 6" stroke="white" strokeWidth="1.5" fill="none" />
                      </svg>
                    )}
                  </div>
                  {e.installed && (
                    <span className="shrink-0 rounded-sm bg-[#10b981]/15 px-1 text-[9px] font-bold text-[#10b981]">INSTALLED</span>
                  )}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-[#858585]">{e.description}</div>
                <div className="mt-1 flex items-center gap-2 text-[10.5px] text-[#6a6a6a]">
                  <span className="text-[#9cdcfe]">{e.publisher}</span>
                  <span className="flex items-center gap-0.5"><ArrowUp size={10} />{e.installs}</span>
                  <span className="flex items-center gap-0.5"><Star size={10} className="fill-[#e2c08d] text-[#e2c08d]" />{e.rating}</span>
                  {!e.installed && (
                    <button className="ml-auto rounded-sm bg-[#007acc] px-2 py-0.5 text-[10px] font-semibold text-white opacity-0 transition-opacity hover:bg-[#1a8ad4] group-hover:opacity-100">Install</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   WelcomePage
   ============================================================ */
const startActions = [
  { label: "New File...", Icon: FileText },
  { label: "Open File...", Icon: FileSearch },
  { label: "Open Folder...", Icon: FolderOpen },
  { label: "Clone Git Repository...", Icon: GitBranch },
  { label: "Connect to...", Icon: Plug },
  { label: "Generate New Workspace...", Icon: LayoutGrid },
];

const legacyRecentProjects = [
  { name: "ALPHA-MAIN", path: "/home/z/ALPHA-MAIN" },
  { name: "iris-ai-main", path: "C:\\Users\\Thunder\\Music\\Temporarily files\\IRIS-AI-main" },
  { name: "alpha-builder-project", path: "C:\\Users\\Thunder\\AppData\\Roaming\\alpha\\Pr…" },
  { name: "vision-store-refactor", path: "/home/z/projects/vision-store-refactor" },
  { name: "Python", path: "C:\\Users\\Thunder\\Documents\\Study\\Python" },
];

const walkthroughs = [
  { title: "Get started with ALPHA", desc: "Customize your editor, learn the basics, and start coding", Icon: Star, badge: null },
  { title: "Meet ALPHA, your new coding partner", desc: "AI pair programmer for code, refactor, and debug", Icon: Bot, badge: "New" },
  { title: "Get Started with TypeScript", desc: "IntelliSense, linting, and debugging for TS/TSX", Icon: Box, badge: "New" },
  { title: "Get Started with Terminal", desc: "Run tasks, debug, and ship faster from the integrated terminal", Icon: TerminalSquare, badge: "Updated" },
  { title: "Getting Started with Container Tools", desc: "Build, ship, and debug containers right inside ALPHA", Icon: Container, badge: "Updated" },
];

function WelcomePage({
  recentWorkspaces,
  onOpenFolder,
  onOpenFile,
  onNewFile,
  onOpenRecent,
}: {
  recentWorkspaces: BuilderWorkspaceSummary[]
  onOpenFolder?: () => void
  onOpenFile?: () => void
  onNewFile?: () => void
  onOpenRecent?: (workspacePath: string) => void
}) {
  return (
    <div className="alpha-scroll h-full w-full overflow-auto bg-[#1e1e1e]">
      <div className="mx-auto max-w-[1000px] px-10 py-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#10b981]/15 ring-1 ring-[#10b981]/30">
            <Sparkles size={20} className="text-[#10b981]" />
          </div>
          <div>
            <h1 className="text-[22px] font-light text-[#ffffff]"><span className="font-semibold">ALPHA</span> Code Editor</h1>
            <p className="text-[12px] text-[#858585]">Editing evolved — AI-native, pixel-perfect.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="space-y-6">
            <section>
              <h2 className="mb-2 text-[14px] font-semibold text-[#ffffff]">Start</h2>
              <div className="space-y-0.5">
                {startActions.map((a) => {
                  const Icon = a.Icon;
                  return (
                    <button
                      key={a.label}
                      onClick={() => {
                        if (a.label === "Open Folder...") onOpenFolder?.();
                        if (a.label === "Open File...") onOpenFile?.();
                        if (a.label === "New File...") onNewFile?.();
                      }}
                      disabled={
                        a.label === "Clone Git Repository..."
                        || a.label === "Connect to..."
                        || a.label === "Generate New Workspace..."
                      }
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left text-[13px] text-[#cccccc] hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icon size={15} className="shrink-0 text-[#4daafc]" /> {a.label}
                    </button>
                  );
                })}
              </div>
            </section>
            <section>
              <h2 className="mb-2 text-[14px] font-semibold text-[#ffffff]">Recent</h2>
              <div className="space-y-0.5">
                {recentWorkspaces.length === 0 && (
                  <div className="px-2 py-2 text-[12px] text-[#858585]">No recent workspaces yet.</div>
                )}
                {recentWorkspaces.map((r) => (
                  <button
                    key={r.path}
                    onClick={() => r.available && onOpenRecent?.(r.path)}
                    disabled={!r.available}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left hover:bg-white/[0.05] disabled:cursor-not-allowed"
                  >
                    <span className={cn("truncate text-[13px]", r.available ? "text-[#cccccc]" : "text-[#6a6a6a]")}>
                      <span className="font-medium text-[#ffffff]">{r.name}</span>{" "}
                      <span className="text-[#6a6a6a]">{r.path}</span>
                    </span>
                    {!r.available && <span className="text-[10px] uppercase tracking-wider text-[#f48771]">Unavailable</span>}
                  </button>
                ))}
              </div>
            </section>
          </div>
          <div>
            <h2 className="mb-2 text-[14px] font-semibold text-[#ffffff]">Walkthroughs</h2>
            <div className="space-y-2">
              {walkthroughs.map((w, i) => {
                const Icon = w.Icon;
                return (
                  <button
                    key={i}
                    className="flex w-full items-start gap-3 rounded-md border border-[#3c3c3c] bg-[#252526] p-3 text-left hover:border-[#4daafc]/40 hover:bg-[#2a2d2e]"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#1e1e1e] ring-1 ring-[#3c3c3c]">
                      <Icon size={16} className="text-[#4daafc]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-[#ffffff]">{w.title}</span>
                        {w.badge && (
                          <span className={cn(
                            "shrink-0 rounded-sm px-1 text-[9px] font-bold uppercase tracking-wide",
                            w.badge === "New" ? "bg-[#007acc]/30 text-[#4daafc]" : "bg-[#10b981]/20 text-[#10b981]",
                          )}>{w.badge}</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[12px] leading-snug text-[#858585]">{w.desc}</div>
                    </div>
                    <ChevronRight size={14} className="mt-1 shrink-0 text-[#6a6a6a]" />
                  </button>
                );
              })}
              <button className="flex items-center gap-1.5 px-1 py-1 text-[12px] text-[#4daafc] hover:underline">More...</button>
            </div>
          </div>
        </div>
        <div className="mt-8 rounded-md border border-[#3c3c3c] bg-[#252526] p-3">
          <button className="flex w-full items-center gap-2 text-left">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#10b981]/15 ring-1 ring-[#10b981]/30">
              <Bot size={16} className="text-[#10b981]" />
            </div>
            <div className="flex-1">
              <div className="text-[13px] font-medium text-[#ffffff]">Try out the new ALPHA Agents window</div>
              <div className="text-[11px] text-[#858585]">Multi-agent workflows, parallel tasks, and live diffs.</div>
            </div>
            <ArrowRight size={14} className="text-[#4daafc]" />
          </button>
        </div>
        <div className="mt-6 flex items-center justify-between text-[11px] text-[#6a6a6a]">
          <span>ALPHA v6.0.1 · commit f7e6b0a</span>
          <span>Keyboard shortcuts <kbd className="rounded bg-[#252526] px-1">Ctrl+K Ctrl+R</kbd></span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   SettingsPanel
   ============================================================ */
const settingsCategories = [
  { id: "common", label: "Common", Icon: Settings },
  { id: "editor", label: "Text Editor", Icon: FileText },
  { id: "files", label: "Files, Folders & Search", Icon: Folder },
  { id: "ai", label: "ALPHA AI", Icon: Sparkles },
  { id: "appearance", label: "Appearance", Icon: Palette },
  { id: "language", label: "Language", Icon: Globe },
  { id: "telemetry", label: "Telemetry", Icon: BellIcon },
  { id: "keyboard", label: "Keyboard", Icon: Keyboard },
  { id: "extensions", label: "Extensions", Icon: GitBranch },
  { id: "account", label: "Account", Icon: User },
  { id: "trusted", label: "Workplace Trust", Icon: KeyRound },
];

type SettingRow =
  | { type: "header"; label: string }
  | { type: "toggle"; label: string; desc?: string; checked?: boolean }
  | { type: "select"; label: string; desc?: string; value: string; options: string[] }
  | { type: "input"; label: string; desc?: string; value: string };

const settingsByCategory: Record<string, SettingRow[]> = {
  common: [
    { type: "header", label: "Common settings" },
    { type: "toggle", label: "Auto save", desc: "Controls auto save of dirty editors.", checked: false },
    { type: "toggle", label: "Hot exit", desc: "Restore unsaved editors on restart.", checked: true },
    { type: "select", label: "Window title bar style", desc: "Adjust the appearance of the window title bar.", value: "Custom", options: ["Native", "Custom"] },
  ],
  ai: [
    { type: "header", label: "ALPHA AI" },
    { type: "select", label: "Default model", desc: "Model used for new ALPHA Agent sessions.", value: "GLM-4.6 Coder", options: ["GLM-4.6 Coder", "GLM-4.6V", "GLM-4.5 Air", "GLM-4 Plus"] },
    { type: "select", label: "Default access level", desc: "Permissions granted to the agent by default.", value: "Safe approve", options: ["Ask for approve", "Safe approve", "Full access"] },
    { type: "toggle", label: "Inline completions", desc: "Show ALPHA ghost-text suggestions as you type.", checked: true },
    { type: "toggle", label: "Auto-apply safe edits", desc: "Apply edits to open files automatically when the agent has Safe access.", checked: false },
    { type: "input", label: "API key", desc: "Leave blank to use the bundled ALPHA AI Connected plan.", value: "sk-••••••••••••••••" },
  ],
  appearance: [
    { type: "header", label: "Appearance" },
    { type: "select", label: "Color theme", desc: "Specifies the color theme used in the workbench.", value: "ALPHA Dark+", options: ["ALPHA Dark+", "Dark+ (legacy)", "Light", "High Contrast"] },
    { type: "select", label: "File icon theme", desc: "Set the file icon theme.", value: "Seti (Visual Studio Code)", options: ["Seti (Visual Studio Code)", "Material Icon Theme", "Minimal"] },
    { type: "select", label: "Product icon theme", desc: "Set the product icon theme.", value: "Default", options: ["Default", "Material", "Carbon"] },
    { type: "toggle", label: "Window: Title Bar Style", desc: "Custom title bar at the top.", checked: true },
  ],
  editor: [
    { type: "header", label: "Text Editor" },
    { type: "toggle", label: "Word wrap", checked: false },
    { type: "toggle", label: "Minimap", desc: "Show the minimap on the side.", checked: true },
    { type: "toggle", label: "Render whitespace", checked: false },
    { type: "select", label: "Tab size", value: "2", options: ["2", "4", "8"] },
    { type: "select", label: "Font family", value: "JetBrains Mono", options: ["JetBrains Mono", "Consolas", "Menlo", "Monaco"] },
  ],
};

function SettingsPanel({
  onClose,
  preferences,
  onPreferencesChange,
  modelOptions,
  selectedModelId,
  onSelectedModelIdChange,
  access,
  onAccessChange,
  modelStatuses,
  onTestProvider,
  onToggleProvider,
}: {
  onClose: () => void
  preferences: BuilderPreferences
  onPreferencesChange: (patch: Partial<BuilderPreferences>) => void
  modelOptions: BuilderModelOption[]
  selectedModelId: string
  onSelectedModelIdChange: (modelId: string) => void
  access: AccessLevel
  onAccessChange: (level: AccessLevel) => void
  modelStatuses: BuilderModelStatuses
  onTestProvider: (group: keyof BuilderModelStatuses, slot: number) => void
  onToggleProvider: (group: keyof BuilderModelStatuses, slot: number, enabled: boolean) => void
}) {
  const [category, setCategory] = useState<string>("common");
  const [query, setQuery] = useState("");
  const filteredModelOptions = useMemo(() => {
    if (!query.trim()) return modelOptions;
    const normalized = query.trim().toLowerCase();
    return modelOptions.filter((option) => option.name.toLowerCase().includes(normalized));
  }, [modelOptions, query]);
  const providerGroups = useMemo(
    () => (Object.entries(modelStatuses) as [keyof BuilderModelStatuses, BuilderModelStatuses[keyof BuilderModelStatuses]][])
      .filter(([, rows]) => rows?.length),
    [modelStatuses]
  );

  return (
    <div className="flex h-full flex-col bg-[#1e1e1e] text-[#cccccc]">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[#2b2b2b] px-3">
        <span className="text-[11px] font-semibold tracking-[0.14em] text-[#cccccc]">SETTINGS</span>
        <div className="ml-auto flex h-6 flex-1 max-w-[300px] items-center gap-1.5 rounded-md border border-[#3c3c3c] bg-[#252526] px-2">
          <Search size={12} className="text-[#858585]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings"
            className="flex-1 bg-transparent text-[12px] text-[#cccccc] placeholder:text-[#6a6a6a] focus:outline-none"
          />
        </div>
        <button onClick={onClose} className="rounded p-1 text-[#858585] hover:bg-white/[0.06] hover:text-[#cccccc]" title="Close"><X size={14} /></button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="alpha-scroll-thin w-56 shrink-0 overflow-y-auto border-r border-[#2b2b2b] py-2">
          {settingsCategories.map((c) => {
            const Icon = c.Icon;
            const isActive = c.id === category;
            return (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors",
                  isActive ? "bg-[#37373d] text-[#ffffff]" : "text-[#cccccc] hover:bg-white/[0.04]",
                )}
              >
                <Icon size={13} className={isActive ? "text-[#ffffff]" : "text-[#858585]"} /> {c.label}
              </button>
            );
          })}
        </div>
        <div className="alpha-scroll-thin flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-[680px]">
            {category === "common" && (
              <>
                <div className="mb-2 mt-2 text-[13px] font-semibold text-[#ffffff]">Common settings</div>
                <ToggleRow
                  label="Auto save"
                  desc="Controls auto save of dirty editors."
                  checked={preferences.autoSave}
                  onChange={(checked) => onPreferencesChange({ autoSave: checked })}
                />
                <SelectRow
                  label="Window title bar style"
                  desc="Builder uses the custom title bar for the VS Code-style layout."
                  value="Custom"
                  options={["Custom"]}
                  onChange={() => undefined}
                  disabled
                />
              </>
            )}

            {category === "ai" && (
              <>
                <div className="mb-2 mt-2 text-[13px] font-semibold text-[#ffffff]">Model providers</div>
                <SelectRow
                  label="Default model"
                  desc="Model used for new Builder coding sessions."
                  value={selectedModelId}
                  options={filteredModelOptions.map((option) => option.id)}
                  labels={Object.fromEntries(filteredModelOptions.map((option) => [option.id, option.name]))}
                  onChange={onSelectedModelIdChange}
                />
                <SelectRow
                  label="Default access level"
                  desc="Permissions granted to the agent by default."
                  value={access}
                  options={["ask", "safe", "full"]}
                  labels={{
                    ask: "Ask for approval",
                    safe: "Approve for me",
                    full: "Full access",
                  }}
                  onChange={(value) => onAccessChange(value as AccessLevel)}
                />
                <div className="mt-4 space-y-3">
                  {providerGroups.length === 0 ? (
                    <div className="rounded-md border border-[#2b2b2b] bg-[#252526] px-3 py-2 text-[12px] text-[#858585]">
                      No provider slots available.
                    </div>
                  ) : (
                    providerGroups.map(([group, rows]) => (
                      <div key={group} className="rounded-md border border-[#2b2b2b] bg-[#252526]">
                        <div className="border-b border-[#2b2b2b] px-3 py-2 text-[12px] font-semibold text-[#ffffff]">
                          {providerDisplayName(String(group))}
                        </div>
                        <div className="divide-y divide-[#2b2b2b]">
                          {rows.map((row) => (
                            <div key={`${group}-${row.slot}`} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                              <button
                                onClick={() => onToggleProvider(group, row.slot, !row.enabled)}
                                className={cn(
                                  "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                                  row.enabled ? "bg-[#007acc]" : "bg-[#3c3c3c]"
                                )}
                              >
                                <span
                                  className={cn(
                                    "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                                    row.enabled ? "left-[18px]" : "left-0.5"
                                  )}
                                />
                              </button>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[#cccccc]">
                                  Slot {row.slot} · {row.modelId || "No model set"}
                                </div>
                                <div className="truncate text-[11px] text-[#858585]">
                                  {row.maskedKey || "No key"} · {row.status || "idle"}
                                  {row.lastFailureReason ? ` · ${row.lastFailureReason}` : ""}
                                </div>
                              </div>
                              <button
                                onClick={() => onTestProvider(group, row.slot)}
                                className="rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1 text-[11px] text-[#cccccc] hover:bg-[#2a2d2e]"
                              >
                                Test
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {category === "editor" && (
              <>
                <div className="mb-2 mt-2 text-[13px] font-semibold text-[#ffffff]">Text Editor</div>
                <ToggleRow
                  label="Word wrap"
                  checked={preferences.wordWrap}
                  onChange={(checked) => onPreferencesChange({ wordWrap: checked })}
                />
                <SelectRow
                  label="Tab size"
                  value={String(preferences.tabSize)}
                  options={["2", "4", "8"]}
                  onChange={(value) => onPreferencesChange({ tabSize: Number(value) || 2 })}
                />
                <SelectRow
                  label="Font family"
                  value={preferences.fontFamily}
                  options={["JetBrains Mono", "Consolas", "Menlo", "Monaco"]}
                  onChange={(value) => onPreferencesChange({ fontFamily: value })}
                />
                <SelectRow
                  label="Font size"
                  value={String(preferences.fontSize)}
                  options={["12", "12.5", "13", "14", "15"]}
                  onChange={(value) => onPreferencesChange({ fontSize: Number(value) || 12.5 })}
                />
              </>
            )}

            {category === "appearance" && (
              <>
                <div className="mb-2 mt-2 text-[13px] font-semibold text-[#ffffff]">Appearance</div>
                <InputRow
                  label="Color theme"
                  desc="Current Builder theme follows the integrated ALPHA dark editor palette."
                  value="ALPHA Dark+"
                  onChange={() => undefined}
                  readOnly
                />
              </>
            )}

            {category !== "common" && category !== "ai" && category !== "editor" && category !== "appearance" && (
              <div className="rounded-md border border-[#2b2b2b] bg-[#252526] px-3 py-2 text-[12px] text-[#858585]">
                Settings for this section will land here next. Current Builder wiring is active.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string
  desc?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#2b2b2b] py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-[#cccccc]">{label}</div>
        {desc && <div className="text-[11px] text-[#858585]">{desc}</div>}
      </div>
      <button onClick={() => onChange(!checked)} className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-[#007acc]" : "bg-[#3c3c3c]")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform", checked ? "left-[18px]" : "left-0.5")} />
      </button>
    </div>
  );
}

function SelectRow({
  label,
  desc,
  value,
  options,
  onChange,
  disabled,
  labels,
}: {
  label: string
  desc?: string
  value: string
  options: string[]
  onChange: (value: string) => void
  disabled?: boolean
  labels?: Record<string, string>
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#2b2b2b] py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-[#cccccc]">{label}</div>
        {desc && <div className="text-[11px] text-[#858585]">{desc}</div>}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="shrink-0 rounded-md border border-[#3c3c3c] bg-[#252526] px-2 py-1 text-[12px] text-[#cccccc] focus:border-[#007acc] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
      </select>
    </div>
  );
}

function InputRow({
  label,
  desc,
  value,
  onChange,
  readOnly,
}: {
  label: string
  desc?: string
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#2b2b2b] py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-[#cccccc]">{label}</div>
        {desc && <div className="text-[11px] text-[#858585]">{desc}</div>}
      </div>
      <input
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className="w-64 shrink-0 rounded-md border border-[#3c3c3c] bg-[#252526] px-2 py-1 text-[12px] text-[#cccccc] focus:border-[#007acc] focus:outline-none read-only:cursor-default read-only:opacity-80"
      />
    </div>
  );
}

/* ============================================================
   ProfilePanel
   ============================================================ */
type Profile = { id: string; name: string; email: string; plan: string; avatar: string; color: string };

const profiles: Profile[] = [
  { id: "alpha", name: "ALPHA Dev", email: "dev@alpha.ai", plan: "ALPHA Pro", avatar: "AD", color: "#10b981" },
  { id: "personal", name: "Personal", email: "you@example.com", plan: "Free", avatar: "PE", color: "#4daafc" },
];

const profileMenu = [
  { id: "profile", label: "Profile", Icon: User },
  { id: "accounts", label: "Signed in Accounts", Icon: User },
  { id: "import", label: "Import GitHub Profile", Icon: GitBranch },
  { id: "email", label: "Email & Sync", Icon: FileText },
  { id: "prefs", label: "Preferences Sync", Icon: Refresh },
  { id: "settings", label: "Account Settings", Icon: Settings },
];

function ProfilePanel({ onClose }: { onClose: () => void }) {
  const [activeId, setActiveId] = useState<string>(profiles[0].id);
  const active = profiles.find((p) => p.id === activeId)!;
  return (
    <div className="flex h-full flex-col bg-[#1e1e1e] text-[#cccccc]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#2b2b2b] px-3">
        <div className="flex items-center gap-1.5">
          <User size={13} className="text-[#cccccc]" />
          <span className="text-[11px] font-semibold tracking-[0.14em] text-[#cccccc]">ACCOUNT</span>
        </div>
        <button onClick={onClose} className="rounded p-1 text-[#858585] hover:bg-white/[0.06] hover:text-[#cccccc]" title="Close"><X size={14} /></button>
      </div>
      <div className="alpha-scroll-thin flex-1 overflow-y-auto p-3">
        <div className="rounded-lg border border-[#3c3c3c] bg-[#252526] p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[16px] font-bold text-white" style={{ backgroundColor: active.color }}>
              {active.avatar}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-[#ffffff]">{active.name}</div>
              <div className="truncate text-[11px] text-[#858585]">{active.email}</div>
              <div className="mt-1 inline-flex items-center gap-1 rounded-sm bg-[#10b981]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#10b981]">
                <Sparkles size={9} /> {active.plan}
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <button className="rounded-md border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1.5 text-[11px] text-[#cccccc] hover:bg-[#2a2d2e]">Manage profile</button>
            <button className="rounded-md border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1.5 text-[11px] text-[#cccccc] hover:bg-[#2a2d2e]">Sign out</button>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[#6a6a6a]">Switch profile</div>
          <div className="space-y-1">
            {profiles.map((p) => {
              const isActive = p.id === activeId;
              return (
                <button
                  key={p.id}
                  onClick={() => setActiveId(p.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                    isActive ? "bg-[#37373d]" : "hover:bg-white/[0.04]",
                  )}
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: p.color }}>
                    {p.avatar}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] text-[#cccccc]">{p.name}</div>
                    <div className="truncate text-[10px] text-[#6a6a6a]">{p.email}</div>
                  </div>
                  {isActive && <Check size={13} className="shrink-0 text-[#10b981]" />}
                </button>
              );
            })}
            <button className="flex w-full items-center gap-2 rounded-md border border-dashed border-[#3c3c3c] px-2 py-1.5 text-left text-[12px] text-[#858585] hover:border-[#4daafc]/40 hover:text-[#4daafc]">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#252526] ring-1 ring-[#3c3c3c]"><Plus size={13} /></div>
              Add a new profile
            </button>
          </div>
        </div>
        <div className="mt-4 space-y-0.5">
          {profileMenu.map((m) => {
            const Icon = m.Icon;
            return (
              <button key={m.id} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] text-[#cccccc] hover:bg-white/[0.04]">
                <Icon size={13} className="text-[#858585]" /> {m.label}
                <ChevronRight size={12} className="ml-auto text-[#6a6a6a]" />
              </button>
            );
          })}
        </div>
        <div className="mt-4 rounded-md border border-[#3c3c3c] bg-[#252526] p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Shield size={12} className="text-[#10b981]" />
              <span className="text-[11px] font-semibold text-[#cccccc]">Usage this month</span>
            </div>
            <span className="text-[10px] text-[#6a6a6a]">Resets in 12 days</span>
          </div>
          <div className="space-y-2">
            <UsageBar label="Agent requests" used={342} total={1000} />
            <UsageBar label="Inline completions" used={1820} total={5000} />
            <UsageBar label="Vision calls" used={48} total={200} />
          </div>
        </div>
      </div>
    </div>
  );
}

function UsageBar({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = Math.min(100, Math.round((used / total) * 100));
  const color = pct > 80 ? "#f48771" : pct > 50 ? "#e2c08d" : "#10b981";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-[#cccccc]">{label}</span>
        <span className="font-mono text-[#858585]">{used.toLocaleString()} / {total.toLocaleString()}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#1e1e1e]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

/* ============================================================
   Placeholder panels (Search / Source Control / Debug)
   ============================================================ */
function PanelShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-[#252526] text-[#cccccc]">
      <div className="flex h-9 items-center justify-between px-3 pt-2">
        <span className="text-[11px] font-semibold tracking-[0.14em] text-[#cccccc]">{title}</span>
      </div>
      <div className="alpha-scroll-thin flex-1 overflow-y-auto px-3 pb-3 text-[12.5px]">{children}</div>
    </div>
  );
}

function LegacySearchPanel() {
  return (
    <PanelShell title="SEARCH">
      <div className="space-y-2">
        <input placeholder="Search" className="w-full rounded-md border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1.5 text-[12.5px] text-[#cccccc] placeholder:text-[#6a6a6a] focus:border-[#007acc] focus:outline-none" />
        <input placeholder="Replace" className="w-full rounded-md border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1.5 text-[12.5px] text-[#cccccc] placeholder:text-[#6a6a6a] focus:border-[#007acc] focus:outline-none" />
        <div className="pt-2 text-[11px] text-[#858585]">12 results in 4 files</div>
      </div>
    </PanelShell>
  );
}

function LegacySourceControlPanel() {
  return (
    <PanelShell title="SOURCE CONTROL">
      <div className="space-y-2">
        <input placeholder='Message (⌘Enter to commit on "feat/vision-source")' className="w-full rounded-md border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1.5 text-[12px] text-[#cccccc] placeholder:text-[#6a6a6a] focus:border-[#007acc] focus:outline-none" />
        <div className="text-[11px] uppercase tracking-wider text-[#6a6a6a]">Changes · 3</div>
        {[
          { f: "alpha.tsx", s: "M" },
          { f: "builderwindow.tsx", s: "M" },
          { f: "visionStore.ts", s: "M" },
        ].map((c) => (
          <div key={c.f} className="flex items-center justify-between rounded-md px-2 py-1 text-[12px] hover:bg-white/[0.04]">
            <span className="text-[#cccccc]">{c.f}</span>
            <span className="font-bold text-[#e2c08d]">{c.s}</span>
          </div>
        ))}
        <button className="mt-2 w-full rounded-md bg-[#007acc]/20 py-1.5 text-[12px] font-semibold text-[#4daafc] ring-1 ring-[#007acc]/40 hover:bg-[#007acc]/30">✓ Commit</button>
      </div>
    </PanelShell>
  );
}

function LegacyDebugPanel() {
  return (
    <PanelShell title="RUN AND DEBUG">
      <div className="space-y-3 text-[12px]">
        <button className="w-full rounded-md bg-[#007acc] py-1.5 text-[12px] font-semibold text-white hover:bg-[#1a8ad4]">▷ Start Debugging</button>
        <div className="text-[11px] uppercase tracking-wider text-[#6a6a6a]">Variables</div>
        {[
          { k: "this", v: "Alpha" },
          { k: "props", v: "{ startVision, isActive }" },
          { k: "showSourceModal", v: "false" },
          { k: "visionState", v: "{ source: null }" },
        ].map((v) => (
          <div key={v.k} className="flex justify-between rounded-md px-2 py-1 hover:bg-white/[0.04]">
            <span className="text-[#9cdcfe]">{v.k}</span>
            <span className="font-mono text-[11px] text-[#858585]">{v.v}</span>
          </div>
        ))}
        <div className="text-[11px] uppercase tracking-wider text-[#6a6a6a]">Call Stack</div>
        <div className="rounded-md bg-[#1e1e1e] p-2 font-mono text-[11px] text-[#858585]">
          <div className="text-[#cccccc]">Alpha (alpha.tsx:62)</div>
          <div>BuilderWindow (builderwindow.tsx:14)</div>
          <div>App (App.tsx:8)</div>
        </div>
      </div>
    </PanelShell>
  );
}

function SearchPanel({
  workspacePath,
  onOpenResult,
}: {
  workspacePath?: string | null
  onOpenResult: (filePath: string) => void
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BuilderWorkspaceSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspacePath) {
      setResults([]);
      setError(null);
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setError(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void searchBuilderWorkspace({ workspacePath, query: trimmed }).then((response) => {
        if (cancelled) return;
        if (!response.success) {
          setError(response.error ?? "Search failed.");
          setResults([]);
        } else {
          setError(null);
          setResults(response.results ?? []);
        }
        setLoading(false);
      });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, workspacePath]);

  const grouped = useMemo<SearchGroup[]>(() => {
    const map = new Map<string, SearchGroup>();
    results.forEach((result) => {
      const existing = map.get(result.filePath);
      if (existing) {
        existing.matches.push(result);
      } else {
        map.set(result.filePath, {
          filePath: result.filePath,
          fileName: result.fileName,
          matches: [result],
        });
      }
    });
    return Array.from(map.values());
  }, [results]);

  return (
    <PanelShell title="SEARCH">
      <div className="space-y-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search workspace"
          className="w-full rounded-md border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1.5 text-[12.5px] text-[#cccccc] placeholder:text-[#6a6a6a] focus:border-[#007acc] focus:outline-none"
        />
        {!workspacePath ? (
          <div className="rounded-md border border-dashed border-[#3c3c3c] bg-[#1e1e1e] px-3 py-3 text-[11px] text-[#858585]">
            Open a folder to search.
          </div>
        ) : loading ? (
          <div className="rounded-md border border-[#3c3c3c] bg-[#1e1e1e] px-3 py-3 text-[11px] text-[#858585]">
            Searching workspace...
          </div>
        ) : error ? (
          <div className="rounded-md border border-[#5a1d1d] bg-[#2a1616] px-3 py-3 text-[11px] text-[#fca5a5]">
            {error}
          </div>
        ) : query.trim() && grouped.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#3c3c3c] bg-[#1e1e1e] px-3 py-3 text-[11px] text-[#858585]">
            No results found.
          </div>
        ) : (
          <div className="space-y-2">
            {grouped.map((group) => (
              <div key={group.filePath} className="rounded-md border border-[#2b2b2b] bg-[#1e1e1e]">
                <div className="border-b border-[#2b2b2b] px-3 py-2 text-[11px] font-medium text-[#cccccc]">
                  {group.fileName}
                </div>
                <div className="divide-y divide-[#2b2b2b]">
                  {group.matches.map((match) => (
                    <button
                      key={`${match.filePath}-${match.line}-${match.preview}`}
                      onClick={() => onOpenResult(match.filePath)}
                      className="block w-full px-3 py-2 text-left hover:bg-white/[0.04]"
                    >
                      <div className="text-[11px] text-[#4daafc]">Line {match.line}</div>
                      <div className="mt-1 text-[11px] text-[#a0a0a0]">{match.preview || "(blank line)"}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PanelShell>
  );
}

function SourceControlPanel() {
  return (
    <PanelShell title="SOURCE CONTROL">
      <div className="rounded-md border border-dashed border-[#3c3c3c] bg-[#1e1e1e] p-3 text-[12px] leading-relaxed text-[#858585]">
        Source control is not wired into this Builder pane yet. Use the workspace files and terminal for now.
      </div>
    </PanelShell>
  );
}

function DebugPanel({
  activeFilePath,
  onRunActiveFile,
}: {
  activeFilePath?: string | null
  onRunActiveFile: () => void
}) {
  return (
    <PanelShell title="RUN AND DEBUG">
      <div className="space-y-3">
        <button
          onClick={onRunActiveFile}
          className="w-full rounded-md bg-[#007acc] py-1.5 text-[12px] font-semibold text-white hover:bg-[#1a8ad4]"
        >
          Run Active File
        </button>
        <div className="rounded-md border border-[#2b2b2b] bg-[#1e1e1e] p-3 text-[12px] leading-relaxed text-[#858585]">
          {activeFilePath
            ? `Ready to run ${basename(activeFilePath)} in the integrated terminal.`
            : "Open a file to run it in the integrated terminal."}
        </div>
      </div>
    </PanelShell>
  );
}

function CreateEntryDialog({
  target,
  onChange,
  onCancel,
  onConfirm,
}: {
  target: PendingCreateTarget
  onChange: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="absolute inset-0 z-[120] flex items-center justify-center bg-black/45 backdrop-blur-[2px]">
      <div className="w-[360px] rounded-lg border border-[#3c3c3c] bg-[#252526] p-4 shadow-2xl">
        <div className="text-[13px] font-semibold text-[#ffffff]">
          {target.kind === "file" ? "New File" : "New Folder"}
        </div>
        <div className="mt-1 text-[11px] text-[#858585]">
          {target.kind === "file" ? "Enter a file name to create it in the current workspace." : "Enter a folder name to create it in the current workspace."}
        </div>
        <input
          autoFocus
          value={target.value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onConfirm();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          className="mt-3 w-full rounded-md border border-[#3c3c3c] bg-[#1e1e1e] px-3 py-2 text-[12px] text-[#cccccc] placeholder:text-[#6a6a6a] focus:border-[#007acc] focus:outline-none"
          placeholder={target.kind === "file" ? "e.g. index.html" : "e.g. components"}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-[#3c3c3c] bg-[#1e1e1e] px-3 py-1.5 text-[12px] text-[#cccccc] hover:bg-white/[0.04]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-[#007acc] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#1a8ad4]"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   BuilderWindow — main component that wires everything together
   ============================================================ */
export function BuilderWindow() {
  const [view, setView] = useState<ActivityView>("explorer");
  const [workspace, setWorkspace] = useState<BuilderWorkspaceSnapshot | null>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<BuilderWorkspaceSummary[]>([]);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>("");
  const [mode, setMode] = useState<EditorMode>("code");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight] = useState(260);
  const [folderOpen, setFolderOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [selectedExplorerPath, setSelectedExplorerPath] = useState<string | null>(null);
  const [selectedExplorerType, setSelectedExplorerType] = useState<"file" | "folder" | null>(null);
  const [cursor, setCursor] = useState<CursorState>({ line: 1, col: 1 });
  const [previewVersion, setPreviewVersion] = useState(0);
  const [modelStatuses, setModelStatuses] = useState<BuilderModelStatuses>({});
  const [modelOptions, setModelOptions] = useState<BuilderModelOption[]>(() => buildModelOptions());
  const [selectedModelId, setSelectedModelId] = useState("kiloGateway-default");
  const [agentInput, setAgentInput] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [chatScopePath, setChatScopePath] = useState<string | null>(null);
  const [chatHydrated, setChatHydrated] = useState(false);
  const [access, setAccess] = useState<AccessLevel>("ask");
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [pendingPayload, setPendingPayload] = useState<BuilderWindowPayload | null>(null);
  const [queuedTerminalCommand, setQueuedTerminalCommand] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState<PendingCreateTarget | null>(null);
  const [lastAgentIntent, setLastAgentIntent] = useState<BuilderAgentIntent>("NORMAL_CHAT");
  const [preferences, setPreferences] = useState<BuilderPreferences>(() => loadBuilderPreferences());
  const [lastCodingContext, setLastCodingContext] = useState<CodingContextState | null>(null);
  const requestLifecycleRef = useRef<Record<string, BuilderRequestLifecycleState>>({});
  const requestThinkingMessageRef = useRef<Record<string, string>>({});

  const appendAgentMessage = useCallback((message: Omit<AgentMessage, "id" | "createdAt">) => {
    setAgentMessages((prev) => [
      ...prev,
      {
        ...message,
        id: makeMessageId(),
        createdAt: new Date().toISOString(),
      },
    ]);
  }, []);

  const replaceAgentMessage = useCallback((messageId: string, patch: Partial<AgentMessage>) => {
    setAgentMessages((prev) =>
      prev.map((message) => (message.id === messageId ? { ...message, ...patch, id: message.id } : message))
    );
  }, []);

  const beginAgentRequest = useCallback((requestId: string, providerLabel?: string) => {
    const thinkingId = makeMessageId();
    requestLifecycleRef.current[requestId] = "running";
    requestThinkingMessageRef.current[requestId] = thinkingId;
    setAgentMessages((prev) => [
      ...prev,
      {
        id: thinkingId,
        role: "status",
        content: "Thinking...",
        createdAt: new Date().toISOString(),
        providerLabel,
        loading: true,
        transient: true,
      },
    ]);
  }, []);

  const finalizeAgentRequest = useCallback(
    (
      requestId: string,
      status: Exclude<BuilderRequestLifecycleState, "idle" | "running">,
      message: Omit<AgentMessage, "id" | "createdAt"> & { createdAt?: string }
    ) => {
      const currentStatus = requestLifecycleRef.current[requestId];
      if (currentStatus && currentStatus !== "running" && currentStatus !== status) {
        return;
      }

      requestLifecycleRef.current[requestId] = status;
      const thinkingId = requestThinkingMessageRef.current[requestId];
      const createdAt = message.createdAt || new Date().toISOString();

      if (thinkingId) {
        replaceAgentMessage(thinkingId, {
          ...message,
          createdAt,
          loading: false,
          transient: false,
        });
      } else {
        appendAgentMessage({
          ...message,
          loading: false,
          transient: false,
        });
      }

      delete requestThinkingMessageRef.current[requestId];
      setActiveRequestId((current) => (current === requestId ? null : current));
    },
    [appendAgentMessage, replaceAgentMessage]
  );

  const syncWorkspaceState = useCallback(
    (snapshot?: BuilderWorkspaceSnapshot | null, recents?: BuilderWorkspaceSummary[]) => {
      if (snapshot !== undefined) {
        setWorkspace(snapshot ?? null);
        setFolderOpen(!!snapshot);
      }
      if (recents) setRecentWorkspaces(recents);
    },
    []
  );

  const openTabFromFile = useCallback(
    (file: { path: string; name: string; content: string }) => {
      const nextTab: OpenTab = {
        name: file.name,
        path: file.path,
        content: file.content,
        dirty: false,
        workspacePath: workspace?.path ?? null,
        isLoose: !isWithinWorkspace(file.path, workspace?.path),
      };
      setTabs((prev) => {
        const existing = prev.find((tab) => tab.path === file.path);
        if (existing) {
          return prev.map((tab) => (tab.path === file.path ? { ...tab, content: file.content, name: file.name } : tab));
        }
        return [...prev, nextTab];
      });
      setActiveTab(file.path);
      setSelectedExplorerPath(file.path);
      setSelectedExplorerType("file");
    },
    [workspace?.path]
  );

  const openPreferredWorkspaceFile = useCallback(
    async (snapshot: BuilderWorkspaceSnapshot | null, preferredRelativePath?: string | null) => {
      const nextPath = findPreferredFilePath(snapshot, preferredRelativePath);
      if (!nextPath) return;
      const response = await readBuilderWorkspaceFile(nextPath);
      if (response.success && response.file) {
        openTabFromFile(response.file);
      }
    },
    [openTabFromFile]
  );

  const syncTabsFromProjectState = useCallback(
    (state: BuilderProjectState) => {
      setTabs((prev) =>
        prev.map((tab) => {
          const relativePath = toWorkspaceRelativePath(tab.path, state.metadata.projectPath);
          if (!relativePath) return tab;
          const nextFile = state.files.find((file) => file.path === relativePath);
          if (!nextFile) return tab;
          return {
            ...tab,
            content: nextFile.content,
            dirty: false,
            workspacePath: state.metadata.projectPath,
          };
        })
      );
    },
    []
  );

  const loadWorkspaceProjectId = useCallback(async (snapshot: BuilderWorkspaceSnapshot | null) => {
    const hasRootProjectMeta = snapshot?.tree.some((node) => node.type === "file" && node.name === "project.json");
    if (!snapshot?.path || !hasRootProjectMeta) {
      setCurrentProjectId(null);
      return null;
    }

    const projectMetaPath = `${snapshot.path.replace(/[\\/]+$/, "")}${snapshot.path.includes("\\") ? "\\" : "/"}project.json`;
    const response = await readBuilderWorkspaceFile(projectMetaPath);
    if (!response.success || !response.file?.content) {
      setCurrentProjectId(null);
      return null;
    }

    try {
      const parsed = JSON.parse(response.file.content) as { id?: string; projectPath?: string };
      const projectId =
        typeof parsed?.id === "string" && parsed.id.trim() && parsed.projectPath === snapshot.path
          ? parsed.id.trim()
          : null;
      setCurrentProjectId(projectId);
      return projectId;
    } catch {
      setCurrentProjectId(null);
      return null;
    }
  }, []);

  useEffect(() => {
    void getBuilderWorkspaceState().then((response) => {
      if (!response.success) return;
      syncWorkspaceState(response.workspace ?? null, response.recentWorkspaces ?? []);
      setChatScopePath(response.workspace?.path ?? null);
      setAgentMessages(loadStoredChat(response.workspace?.path ?? null));
      setChatHydrated(true);
      void loadWorkspaceProjectId(response.workspace ?? null);
      void openPreferredWorkspaceFile(response.workspace ?? null);
    });
  }, [loadWorkspaceProjectId, openPreferredWorkspaceFile, syncWorkspaceState]);

  const refreshModelStatuses = useCallback(async () => {
    const response = await getBuilderModelStatuses();
    if (!response.success) return;
    const nextStatuses = response.statuses ?? {};
    const nextOptions = buildModelOptions(nextStatuses);
    const fallbackId = resolveModelIdForProviderHint(nextOptions, "kiloGateway") ?? "kiloGateway-default";
    const storedModelId = window.localStorage.getItem("alpha-builder-selected-model");
    const chosen = findModelOption(nextOptions, selectedModelId || storedModelId || fallbackId, fallbackId);

    setModelStatuses(nextStatuses);
    setModelOptions(nextOptions);
    setSelectedModelId(chosen?.id ?? fallbackId);
  }, [selectedModelId]);

  useEffect(() => {
    void refreshModelStatuses();
  }, [refreshModelStatuses]);

  useEffect(() => {
    if (!selectedModelId) return;
    window.localStorage.setItem("alpha-builder-selected-model", selectedModelId);
  }, [selectedModelId]);

  useEffect(() => {
    window.localStorage.setItem(BUILDER_PREFERENCES_KEY, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    if (!chatHydrated) return;
    saveStoredChat(chatScopePath, agentMessages);
  }, [agentMessages, chatHydrated, chatScopePath]);

  useEffect(() => {
    void getBuilderWindowState().then((response) => {
      if (response.success && response.payload) {
        setPendingPayload(response.payload);
      }
    });

    const unsubscribe = window.electron.ipcRenderer.on(
      "builder-window-state",
      (_event, payload: BuilderWindowPayload) => {
        setPendingPayload(payload);
      }
    );

    return () => {
      unsubscribe?.();
    };
  }, []);

  const activeTabObj = tabs.find((t) => t.path === activeTab) ?? null;
  const fileName = activeTabObj?.name ?? "";
  const breadcrumbPath = activeTabObj ? breadcrumbFromPath(activeTabObj.path, workspace) : workspace?.name ?? "Empty workspace";
  const previewPath = findPreviewTarget(workspace, activeTabObj);
  const dynamicMenus = useMemo(() => buildMenus(recentWorkspaces), [recentWorkspaces]);
  const workspaceTree = useMemo(() => workspace?.tree.map(toFileNode) ?? [], [workspace]);
  const workspaceFileHints = useMemo(() => collectWorkspaceFilePaths(workspace?.tree ?? [], 24), [workspace?.tree]);
  const showWelcome = !workspace && tabs.length === 0 && !folderOpen;
  const workspaceLabel = workspace?.name ?? "No Folder Opened";
  const selectedModelOption = useMemo(
    () => findModelOption(modelOptions, selectedModelId, resolveModelIdForProviderHint(modelOptions, "kiloGateway")),
    [modelOptions, selectedModelId]
  );
  const currentLanguage = activeTabObj ? languageLabel(activeTabObj.path) : "Plain Text";

  const selectedFolderPath = useMemo(() => {
    if (!workspace?.path) return null;
    if (selectedExplorerPath && selectedExplorerType === "folder" && isWithinWorkspace(selectedExplorerPath, workspace.path)) {
      return selectedExplorerPath;
    }
    if (selectedExplorerPath && selectedExplorerType === "file" && isWithinWorkspace(selectedExplorerPath, workspace.path)) {
      return dirname(selectedExplorerPath);
    }
    if (activeTabObj?.path && isWithinWorkspace(activeTabObj.path, workspace.path)) {
      return dirname(activeTabObj.path);
    }
    return workspace.path;
  }, [workspace?.path, selectedExplorerPath, selectedExplorerType, activeTabObj?.path]);

  const reloadWorkspace = useCallback(async () => {
    if (!workspace?.path) return;
    const response = await refreshBuilderWorkspace(workspace.path);
    if (response.success) {
      syncWorkspaceState(response.workspace ?? null);
      void loadWorkspaceProjectId(response.workspace ?? null);
    } else if (response.error) {
      window.alert(response.error);
    }
  }, [loadWorkspaceProjectId, syncWorkspaceState, workspace?.path]);

  const handleOpenExplorerFile = useCallback(async (_name: string, path: string) => {
    const response = await readBuilderWorkspaceFile(path);
    if (response.success && response.file) {
      openTabFromFile(response.file);
      return;
    }
    if (response.error) window.alert(response.error);
  }, [openTabFromFile]);

  const handleOpenFolder = useCallback(async () => {
    const response = await openBuilderWorkspaceFolderDialog();
    if (!response.success) {
      if (response.error) window.alert(response.error);
      return;
    }
    if (response.cancelled) return;
    syncWorkspaceState(response.workspace ?? null, response.recentWorkspaces ?? []);
    setTabs([]);
    setActiveTab("");
    setSelectedExplorerPath(response.workspace?.path ?? null);
    setSelectedExplorerType("folder");
    setChatScopePath(response.workspace?.path ?? null);
    setAgentMessages(loadStoredChat(response.workspace?.path ?? null));
    setChatHydrated(true);
    await loadWorkspaceProjectId(response.workspace ?? null);
    await openPreferredWorkspaceFile(response.workspace ?? null);
  }, [loadWorkspaceProjectId, openPreferredWorkspaceFile, syncWorkspaceState]);

  const handleOpenRecentWorkspace = useCallback(async (workspacePath: string) => {
    const response = await openBuilderWorkspace(workspacePath);
    if (!response.success) {
      if (response.error) window.alert(response.error);
      return;
    }
    syncWorkspaceState(response.workspace ?? null, response.recentWorkspaces ?? []);
    setTabs([]);
    setActiveTab("");
    setSelectedExplorerPath(response.workspace?.path ?? null);
    setSelectedExplorerType("folder");
    setChatScopePath(response.workspace?.path ?? null);
    setAgentMessages(loadStoredChat(response.workspace?.path ?? null));
    setChatHydrated(true);
    await loadWorkspaceProjectId(response.workspace ?? null);
    await openPreferredWorkspaceFile(response.workspace ?? null);
  }, [loadWorkspaceProjectId, openPreferredWorkspaceFile, syncWorkspaceState]);

  const handleOpenLooseFile = useCallback(async () => {
    const response = await openBuilderLooseFileDialog(workspace?.path);
    if (!response.success) {
      if (response.error) window.alert(response.error);
      return;
    }
    if (response.cancelled || !response.file) return;
    openTabFromFile(response.file);
  }, [openTabFromFile, workspace?.path]);

  const handleCreateFile = useCallback(async () => {
    if (!workspace?.path || !selectedFolderPath) {
      window.alert("Open a workspace folder first.");
      return;
    }
    setPendingCreate({ kind: "file", value: "untitled.txt" });
  }, [selectedFolderPath, workspace?.path]);

  const handleCreateFolder = useCallback(async () => {
    if (!workspace?.path || !selectedFolderPath) {
      window.alert("Open a workspace folder first.");
      return;
    }
    setPendingCreate({ kind: "folder", value: "new-folder" });
  }, [selectedFolderPath, workspace?.path]);

  const handleConfirmCreate = useCallback(async () => {
    if (!pendingCreate || !workspace?.path || !selectedFolderPath) return;
    const name = pendingCreate.value.trim();
    if (!name) return;

    if (pendingCreate.kind === "file") {
      const response = await createBuilderWorkspaceFile({
        workspacePath: workspace.path,
        parentPath: selectedFolderPath,
        name,
      });
      if (!response.success) {
        if (response.error) window.alert(response.error);
        return;
      }
      syncWorkspaceState(response.workspace ?? workspace);
      if (response.file) {
        if (currentProjectId) {
          const relativePath = toWorkspaceRelativePath(response.file.path, workspace.path);
          if (relativePath) {
            await saveBuilderProjectFile(currentProjectId, relativePath, response.file.content);
          }
        }
        openTabFromFile(response.file);
      }
      setPendingCreate(null);
      return;
    }

    const response = await createBuilderWorkspaceFolder({
      workspacePath: workspace.path,
      parentPath: selectedFolderPath,
      name,
    });
    if (!response.success) {
      if (response.error) window.alert(response.error);
      return;
    }
    syncWorkspaceState(response.workspace ?? workspace);
    setPendingCreate(null);
  }, [currentProjectId, openTabFromFile, pendingCreate, selectedFolderPath, syncWorkspaceState, workspace]);

  const handleCancelCreate = useCallback(() => {
    setPendingCreate(null);
  }, []);

  const handleSaveCurrent = useCallback(async () => {
    if (!activeTabObj) return;
    const relativePath = toWorkspaceRelativePath(activeTabObj.path, workspace?.path);
    const response =
      currentProjectId && relativePath
        ? await saveBuilderProjectFile(currentProjectId, relativePath, activeTabObj.content)
        : await writeBuilderWorkspaceFile(activeTabObj.path, activeTabObj.content);
    if (!response.success) {
      window.alert(response.error ?? "Failed to save file.");
      return;
    }
    setTabs((prev) => prev.map((tab) => (tab.path === activeTabObj.path ? { ...tab, dirty: false } : tab)));
    setPreviewVersion((prev) => prev + 1);
    if (workspace?.path) {
      void reloadWorkspace();
    }
  }, [activeTabObj, currentProjectId, reloadWorkspace, workspace?.path]);

  useEffect(() => {
    if (!preferences.autoSave || !activeTabObj?.dirty) return;
    const timeout = window.setTimeout(() => {
      void handleSaveCurrent();
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [activeTabObj?.dirty, activeTabObj?.path, handleSaveCurrent, preferences.autoSave]);

  useEffect(() => {
    if (!workspace?.path || !selectedExplorerPath) return;
    if (!isWithinWorkspace(selectedExplorerPath, workspace.path)) {
      setSelectedExplorerPath(workspace.path);
      setSelectedExplorerType("folder");
    }
  }, [selectedExplorerPath, workspace?.path]);

  const handleOpenFile = useCallback((name: string, path: string) => {
    void handleOpenExplorerFile(name, path);
  }, [handleOpenExplorerFile]);

  const handleEditorChange = useCallback((next: string) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.path === activeTab
          ? { ...tab, content: next, dirty: next !== tab.content ? true : tab.dirty }
          : tab
      )
    );
  }, [activeTab]);

  const handleCloseTab = useCallback((path: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.path !== path);
      if (path === activeTab) {
        if (next.length > 0) {
          const fallback = next[Math.max(0, idx - 1)];
          setActiveTab(fallback.path);
        } else {
          setActiveTab("");
        }
      }
      return next;
    });
  }, [activeTab]);

  const handleActivitySelect = useCallback((v: ActivityView) => {
    if (v === "account") {
      setShowProfile((p) => !p);
      setShowSettings(false);
      return;
    }
    setView(v);
    setShowProfile(false);
    setShowSettings(false);
  }, []);

  const handleSettingsClick = useCallback(() => {
    setShowSettings((s) => !s);
    setShowProfile(false);
  }, []);

  const handlePreferencePatch = useCallback((patch: Partial<BuilderPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleTestProvider = useCallback(async (group: keyof BuilderModelStatuses, slot: number) => {
    const response = await testBuilderModelSlot({ group: group as any, slot });
    if (!response?.success && response?.error) {
      window.alert(response.error);
    }
    await refreshModelStatuses();
  }, [refreshModelStatuses]);

  const handleToggleProvider = useCallback(async (group: keyof BuilderModelStatuses, slot: number, enabled: boolean) => {
    const response = await setBuilderModelEnabled({ group: group as any, slot, enabled });
    if (!response?.success && response?.error) {
      window.alert(response.error);
      return;
    }
    await refreshModelStatuses();
  }, [refreshModelStatuses]);

  const handleRunActiveFile = useCallback(() => {
    if (!activeTabObj?.path) {
      appendAgentMessage({
        role: "status",
        content: "Run karne ke liye pehle active file open karo.",
      });
      return;
    }
    const extension = extname(activeTabObj.path);
    if (extension === "html") {
      setMode("preview");
      return;
    }
    if (extension === "ts") {
      appendAgentMessage({
        role: "assistant",
        content: "TypeScript file ko run karne ke liye project script ya ts-node config chahiye.",
      });
      return;
    }

    const quotedPath = `"${activeTabObj.path}"`;
    const command =
      extension === "py"
        ? `python ${quotedPath}; if ($LASTEXITCODE -ne 0) { py ${quotedPath} }`
        : extension === "js"
          ? `node ${quotedPath}`
          : null;

    if (!command) {
      appendAgentMessage({
        role: "assistant",
        content: `${basename(activeTabObj.path)} ke liye direct run shortcut available nahi hai.`,
      });
      return;
    }

    setTerminalOpen(true);
    setQueuedTerminalCommand(command);
    setView("debug");
  }, [activeTabObj?.path, appendAgentMessage]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const primary = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (primary && key === "s") {
        event.preventDefault();
        void handleSaveCurrent();
        return;
      }

      if (primary && event.altKey && key === "n") {
        event.preventDefault();
        void handleCreateFile();
        return;
      }

      if (primary && !event.shiftKey && key === "n") {
        event.preventDefault();
        void handleCreateFile();
        return;
      }

      if (primary && event.shiftKey && key === "f") {
        event.preventDefault();
        setView("search");
        setShowProfile(false);
        setShowSettings(false);
        return;
      }

      if (primary && key === ",") {
        event.preventDefault();
        setShowSettings(true);
        setShowProfile(false);
        return;
      }

      if ((primary && event.key === "F5") || (primary && key === "f5")) {
        event.preventDefault();
        handleRunActiveFile();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCreateFile, handleRunActiveFile, handleSaveCurrent]);

  const handleWindowAction = useCallback((action: "minimize" | "maximize" | "close") => {
    void window.electron.ipcRenderer.invoke(`builder-window-${action === "maximize" ? "maximize-toggle" : action}`);
  }, []);

  const handleMenuAction = useCallback(async (menuId: string, label: string, actionId?: string) => {
    const l = label.toLowerCase();
    if (actionId?.startsWith("open-recent:")) {
      await handleOpenRecentWorkspace(actionId.slice("open-recent:".length));
      return;
    }
    if (actionId === "clear-recent") {
      const response = await clearBuilderRecentWorkspaces();
      if (response.success) setRecentWorkspaces([]);
      return;
    }
    if (actionId === "open-settings") {
      setShowSettings(true);
      setShowProfile(false);
      return;
    }
    if (actionId === "open-search") {
      setView("search");
      setShowProfile(false);
      setShowSettings(false);
      return;
    }
    if (actionId === "run-active-file") {
      handleRunActiveFile();
      return;
    }
    if (menuId === "terminal") { setTerminalOpen(true); return; }
    if (menuId === "more") {
      if (l.includes("settings")) { setShowSettings(true); setShowProfile(false); return; }
      if (l.includes("welcome")) {
        setFolderOpen(false);
        setWorkspace(null);
        setTabs([]);
        setActiveTab("");
        setCurrentProjectId(null);
        setChatScopePath(null);
        setAgentMessages(loadStoredChat(null));
        return;
      }
      if (l.includes("terminal")) setTerminalOpen(true);
      if (l.includes("explorer")) setView("explorer");
      if (l.includes("search")) setView("search");
      if (l.includes("source control")) setView("scm");
      if (l.includes("extensions")) setView("extensions");
      if (l.includes("run") && !l.includes("run task")) setView("debug");
      if (l.includes("problems") || l.includes("output") || l.includes("debug console") || l.includes("ports")) setTerminalOpen(true);
      return;
    }
    if (menuId === "view") {
      if (l.includes("terminal")) setTerminalOpen(true);
      if (l.includes("explorer")) setView("explorer");
      if (l.includes("search")) setView("search");
      if (l.includes("source control")) setView("scm");
      if (l.includes("extensions")) setView("extensions");
      if (l.includes("run")) setView("debug");
      if (l.includes("problems") || l.includes("output") || l.includes("debug console") || l.includes("ports")) setTerminalOpen(true);
      return;
    }
    if (menuId === "file") {
      if (l.includes("open folder")) { void handleOpenFolder(); return; }
      if (l.includes("open file")) { void handleOpenLooseFile(); return; }
      if (l === "save") { void handleSaveCurrent(); return; }
      if (l.includes("new folder")) { void handleCreateFolder(); return; }
      if (l.includes("new text file") || l.includes("new file")) {
        void handleCreateFile();
        return;
      }
    }
    if (menuId === "run" || (menuId === "terminal" && l.includes("run active file"))) {
      handleRunActiveFile();
    }
  }, [handleCreateFile, handleCreateFolder, handleOpenFolder, handleOpenLooseFile, handleOpenRecentWorkspace, handleRunActiveFile, handleSaveCurrent]);

  const handleAgentStop = useCallback(async () => {
    if (!activeRequestId) return;
    if (requestLifecycleRef.current[activeRequestId] !== "running") return;
    requestLifecycleRef.current[activeRequestId] = "cancelled";
    await cancelBuilderRequest(activeRequestId);
    finalizeAgentRequest(activeRequestId, "cancelled", {
      role: "status",
      content: "Generation cancelled.",
      providerLabel: selectedModelOption?.name,
      tone: "cancelled",
    });
  }, [activeRequestId, finalizeAgentRequest, selectedModelOption?.name]);

  const runAgentPrompt = useCallback(async (rawPrompt?: string, overrideModelId?: string | null) => {
    const prompt = (rawPrompt ?? agentInput).trim();
    if (!prompt || activeRequestId) return;

    const requestedModel = findModelOption(
      modelOptions,
      overrideModelId || selectedModelId,
      resolveModelIdForProviderHint(modelOptions, "kiloGateway")
    );

    setAgentInput("");
    appendAgentMessage({ role: "user", content: prompt });

    if (!requestedModel?.configured) {
      appendAgentMessage({
        role: "assistant",
        content: buildMissingProviderMessage(requestedModel),
        error: true,
        providerLabel: requestedModel?.name,
      });
      return;
    }

    const requestId = `builder-${makeMessageId()}`;
    const providerSelection = requestedModel.selection;
    const normalizedPrompt = prompt.toLowerCase();
    const isCodingFollowUp =
      lastAgentIntent !== "NORMAL_CHAT" &&
      /^(html\/css\/js|html css js|html|css|javascript|js|typescript|react|yes|haan|han|continue|go ahead|same|use )/.test(normalizedPrompt);
    const inferredIntent =
      isCodingFollowUp
        ? currentProjectId || workspace?.path
          ? "CODING_EDIT"
          : "CODING_GENERATE"
        : classifyBuilderAgentPrompt(prompt, !!currentProjectId);
    const intent =
      inferredIntent === "NORMAL_CHAT" &&
      /\b(this html|this file|current file|make this|convert this|turn this)\b/.test(normalizedPrompt)
        ? currentProjectId || workspace?.path
          ? "CODING_EDIT"
          : "CODING_GENERATE"
        : inferredIntent;
    const workspaceContext =
      workspace?.path || activeTabObj?.path
        ? [
            workspace?.path ? `Current workspace: ${workspace.path}` : "",
            workspaceFileHints.length ? `Workspace file tree:\n${workspaceFileHints.join("\n")}` : "",
            activeTabObj?.path ? `Current open file: ${activeTabObj.path}` : "",
            activeTabObj?.content
              ? `Current open file content:\n\`\`\`\n${activeTabObj.content.slice(0, 12000)}\n\`\`\``
              : "",
            "The Builder UI is already open. Do not ask which builder interface or framework to use when the current files already imply the stack.",
            "Return concrete file edits only."
          ]
              .filter(Boolean)
              .join("\n\n")
        : "";
    const effectivePrompt =
      isCodingFollowUp && lastCodingContext
        ? `Continue the previous coding task.\nOriginal task: ${lastCodingContext.originalPrompt}\nFollow-up clarification/preference: ${prompt}\n\n${
            currentProjectId || workspace?.path
              ? "Use the current workspace files and apply concrete edits."
              : "Generate concrete project files directly. Do not answer like general chat."
          }\n\n${workspaceContext}`.trim()
        : intent === "CODING_EDIT" && !currentProjectId && activeTabObj?.path
          ? `${prompt}\n\n${workspaceContext}`.trim()
          : intent === "CODING_EDIT" || intent === "CODING_GENERATE"
            ? `${prompt}\n\n${workspaceContext}`.trim()
            : prompt;
    setActiveRequestId(requestId);
    setLastAgentIntent(intent);
    if (intent === "CODING_GENERATE" || intent === "CODING_EDIT") {
      setLastCodingContext({
        originalPrompt: isCodingFollowUp && lastCodingContext ? lastCodingContext.originalPrompt : prompt,
        intent,
        createdAt: new Date().toISOString(),
      });
    }
    beginAgentRequest(requestId, requestedModel.name);

    try {
      if (intent === "RUN_COMMAND") {
        setTerminalOpen(true);
        setQueuedTerminalCommand(prompt);
        finalizeAgentRequest(requestId, "completed", {
          role: "assistant",
          content: "Command terminal me queue kar diya hai.",
          providerLabel: requestedModel.name,
        });
        return;
      }

      if (intent === "NORMAL_CHAT" || intent === "EXPLAIN_CODE") {
        const response = await chatBuilderPrompt(effectivePrompt, providerSelection, currentProjectId ?? undefined, requestId);
        if (!response.success) {
          if (response.cancelled) {
            return;
          }
          finalizeAgentRequest(requestId, "failed", {
            role: "assistant",
            content: response.error || "Provider request failed.",
            error: true,
            providerLabel: response.providerLabel || requestedModel.name,
          });
          return;
        }
        if (requestLifecycleRef.current[requestId] !== "running") {
          return;
        }
        finalizeAgentRequest(requestId, "completed", {
          role: "assistant",
          content: response.message || "Done.",
          providerLabel: response.providerLabel || requestedModel.name,
        });
        return;
      }

      const response =
        intent === "CODING_EDIT" && currentProjectId
          ? await updateBuilderProject(currentProjectId, effectivePrompt, providerSelection, requestId)
          : await createBuilderProject(effectivePrompt, providerSelection, requestId);

      if (!response.success || !response.state) {
        if (response.cancelled) {
          return;
        }
        finalizeAgentRequest(requestId, "failed", {
          role: "assistant",
          content: response.error || response.providerError || "Builder request failed.",
          error: true,
          providerLabel: requestedModel.name,
        });
        return;
      }
      if (requestLifecycleRef.current[requestId] !== "running") {
        return;
      }

      const workspaceResponse = await openBuilderWorkspace(response.state.metadata.projectPath);
      if (workspaceResponse.success) {
        const isSameProject = currentProjectId === response.state.metadata.id;
        if (!isSameProject) {
          setTabs([]);
          setActiveTab("");
        }
        syncWorkspaceState(workspaceResponse.workspace ?? null, workspaceResponse.recentWorkspaces ?? []);
        setChatScopePath(response.state.metadata.projectPath);
        setChatHydrated(true);
        setCurrentProjectId(response.state.metadata.id);
        setSelectedExplorerPath(workspaceResponse.workspace?.path ?? null);
        setSelectedExplorerType("folder");
        syncTabsFromProjectState(response.state);
        await openPreferredWorkspaceFile(
          workspaceResponse.workspace ?? null,
          response.state.files?.[0]?.path ?? null
        );
      }

      setPreviewVersion((prev) => prev + 1);
      finalizeAgentRequest(requestId, "completed", {
        role: "assistant",
        content:
          response.providerError ||
          response.message ||
          `Applied ${response.state.files.length} file update${response.state.files.length === 1 ? "" : "s"}.`,
        error: false,
        providerLabel: response.state.metadata.providerUsed,
        tone: "success",
      });
    } catch (error: any) {
      const cancelled = error?.name === "AbortError";
      const requestState = requestLifecycleRef.current[requestId];
      if (requestState === "cancelled" || requestState === "completed") {
        return;
      }
      finalizeAgentRequest(requestId, cancelled ? "cancelled" : "failed", {
        role: cancelled ? "status" : "assistant",
        content: cancelled ? "Generation cancelled." : error?.message || "Builder request failed.",
        error: !cancelled,
        providerLabel: requestedModel.name,
        tone: cancelled ? "cancelled" : "default",
      });
    } finally {
      setActiveRequestId((current) => (current === requestId ? null : current));
    }
  }, [
    activeRequestId,
    agentInput,
    appendAgentMessage,
    beginAgentRequest,
    currentProjectId,
    finalizeAgentRequest,
    lastCodingContext,
    lastAgentIntent,
    modelOptions,
    openPreferredWorkspaceFile,
    selectedModelId,
    syncTabsFromProjectState,
    syncWorkspaceState,
    workspaceFileHints,
    workspace?.path,
    workspaceLabel,
    activeTabObj?.content,
    activeTabObj?.path,
  ]);

  useEffect(() => {
    if (!pendingPayload) return;

    const providerModelId = resolveModelIdForProviderHint(modelOptions, pendingPayload.selectedProvider);
    if (pendingPayload.selectedProvider && !providerModelId && Object.keys(modelStatuses).length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      if (providerModelId) {
        setSelectedModelId(providerModelId);
      }

      if (pendingPayload.state?.metadata?.projectPath) {
        const workspaceResponse = await openBuilderWorkspace(pendingPayload.state.metadata.projectPath);
        if (!cancelled && workspaceResponse.success) {
          setTabs([]);
          setActiveTab("");
          syncWorkspaceState(workspaceResponse.workspace ?? null, workspaceResponse.recentWorkspaces ?? []);
          setSelectedExplorerPath(workspaceResponse.workspace?.path ?? null);
          setSelectedExplorerType("folder");
          setChatScopePath(pendingPayload.state.metadata.projectPath);
          setAgentMessages(loadStoredChat(pendingPayload.state.metadata.projectPath));
          setChatHydrated(true);
          setCurrentProjectId(pendingPayload.state.metadata.id);
          syncTabsFromProjectState(pendingPayload.state);
          await openPreferredWorkspaceFile(
            workspaceResponse.workspace ?? null,
            pendingPayload.state.files?.[0]?.path ?? null
          );
        }
      }

      if (!cancelled && pendingPayload.providerError) {
        appendAgentMessage({
          role: "assistant",
          content: pendingPayload.providerError,
          error: true,
          providerLabel: pendingPayload.selectedProvider,
        });
      }

      if (!cancelled && pendingPayload.prompt && pendingPayload.autoStart) {
        await runAgentPrompt(pendingPayload.prompt, providerModelId ?? undefined);
      }

      if (!cancelled) {
        setPendingPayload(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    appendAgentMessage,
    modelStatuses,
    modelOptions,
    openPreferredWorkspaceFile,
    pendingPayload,
    runAgentPrompt,
    syncTabsFromProjectState,
    syncWorkspaceState,
  ]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#1e1e1e] text-[#cccccc]">
      <TitleBar
        workspaceLabel={workspaceLabel}
        menus={dynamicMenus}
        onMenuAction={handleMenuAction}
        onWindowAction={handleWindowAction}
      />
      <div className="flex min-h-0 flex-1">
        <ActivityBar
          active={showSettings ? "explorer" : showProfile ? "account" : view}
          onSelect={handleActivitySelect}
          onSettingsClick={handleSettingsClick}
        />

        {showSettings ? (
          <aside className="w-[420px] shrink-0 border-r border-[#2b2b2b]">
            <SettingsPanel
              onClose={() => setShowSettings(false)}
              preferences={preferences}
              onPreferencesChange={handlePreferencePatch}
              modelOptions={modelOptions}
              selectedModelId={selectedModelId}
              onSelectedModelIdChange={setSelectedModelId}
              access={access}
              onAccessChange={setAccess}
              modelStatuses={modelStatuses}
              onTestProvider={handleTestProvider}
              onToggleProvider={handleToggleProvider}
            />
          </aside>
        ) : showProfile ? (
          <aside className="w-[320px] shrink-0 border-r border-[#2b2b2b]">
            <ProfilePanel onClose={() => setShowProfile(false)} />
          </aside>
        ) : view === "agent" ? (
          <aside className="w-[320px] shrink-0 border-r border-[#2b2b2b]">
            <CodingAgent
              messages={agentMessages}
              input={agentInput}
              onInputChange={setAgentInput}
              onSend={() => void runAgentPrompt()}
              onStop={() => void handleAgentStop()}
              running={!!activeRequestId}
              selectedModelId={selectedModelOption?.id ?? selectedModelId}
              modelOptions={modelOptions}
              onModelChange={setSelectedModelId}
              access={access}
              onAccessChange={setAccess}
              workspaceName={workspaceLabel}
              activeFileName={activeTabObj?.name}
            />
          </aside>
        ) : view === "search" ? (
          <aside className="w-[280px] shrink-0 border-r border-[#2b2b2b]">
            <SearchPanel workspacePath={workspace?.path} onOpenResult={(filePath) => void handleOpenExplorerFile("", filePath)} />
          </aside>
        ) : view === "scm" ? (
          <aside className="w-[280px] shrink-0 border-r border-[#2b2b2b]"><SourceControlPanel /></aside>
        ) : view === "extensions" ? (
          <aside className="w-[300px] shrink-0 border-r border-[#2b2b2b]"><ExtensionsPanel /></aside>
        ) : view === "debug" ? (
          <aside className="w-[280px] shrink-0 border-r border-[#2b2b2b]">
            <DebugPanel activeFilePath={activeTabObj?.path} onRunActiveFile={handleRunActiveFile} />
          </aside>
        ) : folderOpen ? (
          <aside className="w-[280px] shrink-0 border-r border-[#2b2b2b]">
            <FileExplorer
              workspaceName={workspaceLabel}
              tree={workspaceTree}
              activePath={activeTab}
              selectedPath={selectedExplorerPath}
              onOpenFile={handleOpenFile}
              onSelectPath={(path, type) => {
                setSelectedExplorerPath(path);
                setSelectedExplorerType(type);
              }}
              onCreateFile={handleCreateFile}
              onCreateFolder={handleCreateFolder}
              onRefresh={() => void reloadWorkspace()}
            />
          </aside>
        ) : null}

        <main className="relative flex min-w-0 flex-1 flex-col">
          {showWelcome ? (
            <WelcomePage
              recentWorkspaces={recentWorkspaces}
              onOpenFolder={() => void handleOpenFolder()}
              onOpenFile={() => void handleOpenLooseFile()}
              onNewFile={() => void handleCreateFile()}
              onOpenRecent={(workspacePath) => void handleOpenRecentWorkspace(workspacePath)}
            />
          ) : (
            <>
              <TabBar
                tabs={tabs} activeTab={activeTab} mode={mode}
                onSelect={setActiveTab} onClose={handleCloseTab} onModeChange={setMode}
              />
              <Breadcrumbs path={breadcrumbPath} modified={activeTabObj?.dirty} />
              <div className="relative min-h-0 flex-1">
                {mode === "code" && (
                  <div className="h-full w-full">
                    {activeTabObj ? (
                      <FunctionalCodeEditor
                        fileName={fileName}
                        code={activeTabObj.content}
                        onChange={handleEditorChange}
                        onCursorChange={setCursor}
                        fontSize={preferences.fontSize}
                        fontFamily={preferences.fontFamily}
                        wordWrap={preferences.wordWrap}
                        tabSize={preferences.tabSize}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[13px] text-[#858585]">Select a file to edit.</div>
                    )}
                  </div>
                )}
                {mode === "preview" && <div className="h-full w-full"><LivePreview previewPath={previewPath} previewVersion={previewVersion} /></div>}
                {mode === "split" && (
                  <PanelGroup orientation="horizontal" className="h-full w-full">
                    <Panel defaultSize={50} minSize={25}>
                      {activeTabObj ? (
                        <FunctionalCodeEditor
                          fileName={fileName}
                          code={activeTabObj.content}
                          onChange={handleEditorChange}
                          onCursorChange={setCursor}
                          fontSize={preferences.fontSize}
                          fontFamily={preferences.fontFamily}
                          wordWrap={preferences.wordWrap}
                          tabSize={preferences.tabSize}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[13px] text-[#858585]">Select a file to edit.</div>
                      )}
                    </Panel>
                    <PanelResizeHandle className="w-[3px] bg-[#1e1e1e] transition-colors hover:bg-[#007acc]" />
                    <Panel defaultSize={50} minSize={25}><LivePreview previewPath={previewPath} previewVersion={previewVersion} /></Panel>
                  </PanelGroup>
                )}
              </div>
              {terminalOpen && (
                <TerminalPanel
                  height={terminalHeight}
                  onClose={() => setTerminalOpen(false)}
                  onMinimize={() => setTerminalOpen(false)}
                  workspacePath={workspace?.path}
                  queuedCommand={queuedTerminalCommand}
                  onQueuedCommandHandled={() => setQueuedTerminalCommand(null)}
                />
              )}
            </>
          )}
          {pendingCreate && (
            <CreateEntryDialog
              target={pendingCreate}
              onChange={(value) => setPendingCreate((prev) => (prev ? { ...prev, value } : prev))}
              onCancel={handleCancelCreate}
              onConfirm={() => void handleConfirmCreate()}
            />
          )}
          <StatusBar
            fileName={fileName}
            ln={cursor.line}
            col={cursor.col}
            branch={workspace?.branch}
            language={currentLanguage}
            hasWorkspace={!!workspace}
          />
        </main>
      </div>
    </div>
  );
}

export default BuilderWindow;
