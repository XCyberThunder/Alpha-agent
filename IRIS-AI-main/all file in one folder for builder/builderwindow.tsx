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
import {
  Files, Search, Sparkles, GitBranch, Bug, Blocks, User, Settings,
  ChevronRight, ChevronDown, FileText, FileCode2, FileJson, FileCog,
  File as FileIcon, Folder, FolderOpen, MoreHorizontal, RefreshCw,
  ListTree, ListChecks, Filter, Plus, History, Paperclip, AtSign, ArrowUp, Code2,
  Wrench, Check, Cpu, Zap, Brain, X, Shield, ShieldCheck, ShieldAlert,
  Lock, Globe, Terminal as TerminalIcon, Eye, Columns2, SplitSquareHorizontal,
  Camera, Monitor, Wifi, BatteryFull, Signal, Mic, Play, RefreshCw as Refresh,
  GitBranch as GitIcon, AlertCircle, Info, Bell, Radio, ChevronLeft,
  Minus, Square, LayoutGrid, Github, Plug, Star, Bot, Box, TerminalSquare,
  Container, ArrowRight, MessageSquare, Maximize2, Undo2, FileSearch,
  TestTube, BookOpen, KeyRound, Bell as BellIcon, Palette, Keyboard,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover, PopoverTrigger, PopoverContent,
  ResizablePanel as Panel,
  ResizablePanelGroup as PanelGroup,
  ResizableHandle as PanelResizeHandle,
} from "@/components/ui";

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

type OpenTab = { name: string; path: string; dirty?: boolean };

type MenuItem =
  | { type: "item"; label: string; shortcut?: string; checked?: boolean; submenu?: MenuItem[] }
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

/* ============================================================
   Menu definitions
   ============================================================ */
const menus: MenuDef[] = [
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
          { type: "item", label: "ALPHA-MAIN", checked: true },
          { type: "item", label: "iris-ai-main" },
          { type: "separator" },
          { type: "item", label: "More..." },
          { type: "item", label: "Clear Recently Opened" },
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
          { type: "item", label: "Settings", shortcut: "Ctrl+," },
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
      { type: "item", label: "Find in Files", shortcut: "Ctrl+Shift+F" },
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
      { type: "item", label: "Search", shortcut: "Ctrl+Shift+F" },
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
      { type: "item", label: "Run Without Debugging", shortcut: "Ctrl+F5" },
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
      { type: "item", label: "Run Active File" },
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
      { type: "item", label: "Settings", shortcut: "Ctrl+," },
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

/* ============================================================
   MenuBar (dropdown menus)
   ============================================================ */
function MenuBar({
  menus: menuList,
  onAnyAction,
}: {
  menus: MenuDef[];
  onAnyAction?: (menuId: string, label: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoverSubmenu, setHoverSubmenu] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openId) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenId(null);
        setHoverSubmenu(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpenId(null); setHoverSubmenu(null); }
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
                hoverSubmenu={hoverSubmenu}
                setHoverSubmenu={setHoverSubmenu}
                onClose={() => { setOpenId(null); setHoverSubmenu(null); }}
                onAction={(label) => onAnyAction?.(m.id, label)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Dropdown({
  items, hoverSubmenu, setHoverSubmenu, onClose, onAction, nested,
}: {
  items: MenuItem[];
  hoverSubmenu: number | null;
  setHoverSubmenu: (n: number | null) => void;
  onClose: () => void;
  onAction: (label: string) => void;
  nested?: boolean;
}) {
  return (
    <div className={cn(
      "absolute z-50 min-w-[260px] animate-fade-in rounded-md border border-[#454545] bg-[#252526] py-1 shadow-2xl",
      nested ? "left-full top-0 ml-0.5" : "left-0 top-full mt-0.5",
    )}>
      {items.map((item, i) => {
        if (item.type === "separator") {
          return <div key={i} className="my-1 h-px bg-[#454545]" />;
        }
        const hasSubmenu = !!item.submenu?.length;
        const isSubmenuOpen = hoverSubmenu === i;
        return (
          <div key={i} className="relative">
            <button
              onClick={() => {
                if (hasSubmenu) return;
                onAction(item.label);
                onClose();
              }}
              onMouseEnter={() => {
                if (hasSubmenu) setHoverSubmenu(i);
                else setHoverSubmenu(null);
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
                hoverSubmenu={hoverSubmenu}
                setHoverSubmenu={setHoverSubmenu}
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
function TitleBar({ onMenuAction }: { onMenuAction?: (menuId: string, label: string) => void }) {
  return (
    <div className="relative flex h-9 items-center justify-between border-b border-black/40 bg-[#3c3c3c] px-2 text-[12px] text-[#cccccc] select-none">
      <div className="flex items-center">
        <MenuBar menus={menus} onAnyAction={onMenuAction} />
      </div>
      <div className="absolute left-1/2 top-1/2 flex w-[min(440px,40vw)] -translate-x-1/2 -translate-y-1/2 items-center">
        <div className="flex h-6 w-full items-center gap-2 rounded-md border border-[#4a4a4a] bg-[#252526] px-2 text-[12px] text-[#969696] hover:border-[#5a5a5a] hover:bg-[#2a2a2a]">
          <Search size={13} className="shrink-0 text-[#969696]" />
          <span className="truncate">ALPHA-MAIN</span>
          <ChevronDown size={12} className="shrink-0 text-[#6a6a6a]" />
        </div>
      </div>
      <div className="flex items-center">
        <WindowBtn title="Minimize"><Minus size={14} strokeWidth={1.5} /></WindowBtn>
        <WindowBtn title="Maximize"><Square size={11} strokeWidth={1.5} /></WindowBtn>
        <WindowBtn title="Close" danger><X size={14} strokeWidth={1.5} /></WindowBtn>
      </div>
    </div>
  );
}

function WindowBtn({
  title, children, danger,
}: {
  title: string; children: React.ReactNode; danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={(e) => e.preventDefault()}
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
  activePath, onOpenFile,
}: {
  activePath: string;
  onOpenFile: (name: string, path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set([
    "ALPHA-MAIN/src/renderer/src/store",
    "ALPHA-MAIN/src/renderer/src/tools",
    "ALPHA-MAIN/src/renderer/src/types",
    "ALPHA-MAIN/src/renderer/src/utils",
    "ALPHA-MAIN/public",
  ]));
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
        <button className="flex items-center gap-1 hover:text-white" onClick={() => toggle("ALPHA-MAIN")}>
          <ChevronDown size={14} className="text-[#858585]" />
          ALPHA-MAIN
        </button>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <FileText size={13} className="text-[#858585] hover:text-[#cccccc]" />
          <Folder size={13} className="text-[#858585] hover:text-[#cccccc]" />
          <RefreshCw size={13} className="text-[#858585] hover:text-[#cccccc]" />
        </div>
      </div>
      <div className="alpha-scroll-thin min-h-0 flex-1 overflow-y-auto pb-3 text-[13px] leading-6">
        {projectTree[0].children?.map((node) => (
          <TreeNode
            key={node.path} node={node} depth={1}
            collapsed={collapsed} onToggle={toggle}
            activePath={activePath} onOpenFile={onOpenFile}
          />
        ))}
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
            <div className="flex items-center gap-1.5 py-0.5 pl-1 hover:text-[#cccccc]">
              <ChevronRight size={12} />
              <span className="text-[#4ec9b0]">interface</span>
              <span className="text-[#cccccc]">AlphaProps</span>
            </div>
            <div className="flex items-center gap-1.5 py-0.5 pl-1 hover:text-[#cccccc]">
              <ChevronRight size={12} />
              <span className="text-[#569cd6]">const</span>
              <span className="text-[#cccccc]">Alpha</span>
            </div>
            <div className="flex items-center gap-1.5 py-0.5 pl-5 hover:text-[#cccccc]">
              <span className="text-[#858585]">useState (false)</span>
            </div>
            <div className="flex items-center gap-1.5 py-0.5 pl-5 hover:text-[#cccccc]">
              <span className="text-[#858585]">useVisionStore()</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TreeNode({
  node, depth, collapsed, onToggle, activePath, onOpenFile,
}: {
  node: FileNode; depth: number;
  collapsed: Set<string>; onToggle: (path: string) => void;
  activePath: string; onOpenFile: (name: string, path: string) => void;
}) {
  const isFolder = node.type === "folder";
  const isCollapsed = collapsed.has(node.path);
  const isActive = activePath === node.path;

  if (isFolder) {
    return (
      <div>
        <button
          onClick={() => onToggle(node.path)}
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
                activePath={activePath} onOpenFile={onOpenFile}
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
      onClick={() => onOpenFile(node.name, node.path)}
      className={cn(
        "group relative flex w-full items-center gap-1.5 py-[1px] pr-2 text-left transition-colors",
        isActive ? "bg-[#37373d]" : "hover:bg-white/[0.04]",
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

function ModelSelector({ current, onChange }: { current: string; onChange: (id: string) => void }) {
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

function AccessLevelSelector({ current, onChange }: { current: AccessLevel; onChange: (lvl: AccessLevel) => void }) {
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

function CodingAgent() {
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
          <ModelSelector current={model} onChange={setModel} />
          <div className="flex items-center gap-1">
            <span className="h-3 w-px bg-[#3c3c3c]" />
            <AccessLevelSelector current={access} onChange={setAccess} />
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
function Breadcrumbs({ path }: { path: string }) {
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
function StatusBar({ fileName, ln, col }: { fileName: string; ln: number; col: number }) {
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

function TerminalPanel({
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
          <TerminalBody
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

function TerminalBody({
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

const STARTER_CODE = `import React, { useState } from 'react';
import { motion } from 'framer-motion';

interface AlphaProps {
  startVision: (source: 'camera' | 'screen') => void;
  isActive: boolean;
}

const Alpha = (props: AlphaProps) => {
  const [showSourceModal, setShowSourceModal] = useState(false);

  return (
    <motion.div className="relative h-full w-full">
      <button onClick={() => setShowSourceModal(true)}>
        Select source
      </button>
    </motion.div>
  );
};

export default Alpha;
`;

function FunctionalCodeEditor({ fileName }: { fileName: string }) {
  const [code, setCode] = useState<string>(STARTER_CODE);
  const [cursorPos, setCursorPos] = useState(0);
  const [suggestIdx, setSuggestIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

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

  const handleScroll = useCallback(() => {
    if (overlayRef.current && textareaRef.current) {
      overlayRef.current.scrollTop = textareaRef.current.scrollTop;
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCode(e.target.value);
    setCursorPos(e.target.selectionStart);
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCursorPos(e.currentTarget.selectionStart);
  };

  const acceptSuggestion = (s: Suggestion) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const before = code.slice(0, cursorPos);
    const after = code.slice(cursorPos);
    const wordStart = before.length - currentWord.length;
    const newCode = code.slice(0, wordStart) + s.insert + after;
    const newCursor = wordStart + s.insert.length;
    setCode(newCode);
    setCursorPos(newCursor);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCursor, newCursor);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
      const newCode = code.slice(0, start) + "  " + code.slice(end);
      setCode(newCode);
      setCursorPos(start + 2);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; });
    }
  };

  const caretCoords = useMemo<{ top: number; left: number } | null>(() => {
    if (!showSuggest) return null;
    const upto = code.slice(0, cursorPos);
    const lineIdx = (upto.match(/\n/g)?.length) ?? 0;
    const lineStart = upto.lastIndexOf("\n") + 1;
    const colInLine = cursorPos - lineStart;
    return { top: lineIdx * 19.4 + 20, left: colInLine * 7.2 + 16 };
  }, [showSuggest, code, cursorPos]);

  const lines = code.split("\n");

  return (
    <div className="alpha-scroll relative flex h-full w-full overflow-auto bg-[#1e1e1e] font-mono text-[12.5px] leading-[1.55]">
      <div className="flex min-w-full">
        <div className="sticky left-0 z-10 select-none bg-[#1e1e1e] pr-3 pl-4 text-right text-[12px] text-[#858585]">
          {lines.map((_, i) => (
            <div key={i} className="h-[19.4px] leading-[19.4px]">{i + 1}</div>
          ))}
        </div>
        <div className="relative flex-1 pl-4 pr-8">
          <pre
            ref={overlayRef}
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 m-0 whitespace-pre overflow-auto px-4 py-0 text-[12.5px] leading-[1.55] text-[#d4d4d4]"
            style={{ width: "100%", height: "100%" }}
          >
            {lines.map((line, i) => (
              <div key={i} className="code-line min-h-[19.4px]">
                {tokenizeLine(line).map((t, j) => (
                  <span key={j} className={t.cls}>{t.text}</span>
                ))}
                {line.length === 0 ? "\u00a0" : null}
              </div>
            ))}
          </pre>
          <textarea
            ref={textareaRef}
            value={code}
            onChange={handleChange}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            onSelect={handleSelect}
            onClick={handleSelect}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="absolute left-0 top-0 h-full w-full resize-none bg-transparent px-4 py-0 font-mono text-[12.5px] leading-[1.55] text-transparent caret-[#aeafad] focus:outline-none"
            style={{ caretColor: "#aeafad" }}
          />
          <div className="h-40" />
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
function LivePreview({ fileName }: { fileName: string }) {
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
  { label: "Clone Git Repository...", Icon: Github },
  { label: "Connect to...", Icon: Plug },
  { label: "Generate New Workspace...", Icon: LayoutGrid },
];

const recentProjects = [
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

function WelcomePage({ onOpenFolder }: { onOpenFolder?: () => void }) {
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
                      onClick={() => a.label === "Open Folder..." && onOpenFolder?.()}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left text-[13px] text-[#cccccc] hover:bg-white/[0.05]"
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
                {recentProjects.map((r) => (
                  <button
                    key={r.name}
                    onClick={() => onOpenFolder?.()}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left hover:bg-white/[0.05]"
                  >
                    <span className="truncate text-[13px] text-[#cccccc]">
                      <span className="font-medium text-[#ffffff]">{r.name}</span>{" "}
                      <span className="text-[#6a6a6a]">{r.path}</span>
                    </span>
                  </button>
                ))}
                <button className="flex items-center gap-1.5 px-2 py-1 text-[12px] text-[#4daafc] hover:underline">More...</button>
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

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<string>("common");
  const [query, setQuery] = useState("");
  const rows = settingsByCategory[category] ?? [];

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
            {rows.map((r, i) => {
              if (r.type === "header") return <div key={i} className="mb-2 mt-2 text-[13px] font-semibold text-[#ffffff]">{r.label}</div>;
              if (r.type === "toggle") return <ToggleRow key={i} label={r.label} desc={r.desc} defaultChecked={r.checked} />;
              if (r.type === "select") return <SelectRow key={i} label={r.label} desc={r.desc} value={r.value} options={r.options} />;
              if (r.type === "input") return <InputRow key={i} label={r.label} desc={r.desc} value={r.value} />;
              return null;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, desc, defaultChecked }: { label: string; desc?: string; defaultChecked?: boolean }) {
  const [on, setOn] = useState(!!defaultChecked);
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#2b2b2b] py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-[#cccccc]">{label}</div>
        {desc && <div className="text-[11px] text-[#858585]">{desc}</div>}
      </div>
      <button onClick={() => setOn((v) => !v)} className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-[#007acc]" : "bg-[#3c3c3c]")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform", on ? "left-[18px]" : "left-0.5")} />
      </button>
    </div>
  );
}

function SelectRow({ label, desc, value, options }: { label: string; desc?: string; value: string; options: string[] }) {
  const [v, setV] = useState(value);
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#2b2b2b] py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-[#cccccc]">{label}</div>
        {desc && <div className="text-[11px] text-[#858585]">{desc}</div>}
      </div>
      <select
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="shrink-0 rounded-md border border-[#3c3c3c] bg-[#252526] px-2 py-1 text-[12px] text-[#cccccc] focus:border-[#007acc] focus:outline-none"
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function InputRow({ label, desc, value }: { label: string; desc?: string; value: string }) {
  const [v, setV] = useState(value);
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#2b2b2b] py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-[#cccccc]">{label}</div>
        {desc && <div className="text-[11px] text-[#858585]">{desc}</div>}
      </div>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="w-64 shrink-0 rounded-md border border-[#3c3c3c] bg-[#252526] px-2 py-1 text-[12px] text-[#cccccc] focus:border-[#007acc] focus:outline-none"
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
  { id: "import", label: "Import GitHub Profile", Icon: Github },
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

function SearchPanel() {
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

function SourceControlPanel() {
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

function DebugPanel() {
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

/* ============================================================
   BuilderWindow — main component that wires everything together
   ============================================================ */
const initialTabs: OpenTab[] = [
  { name: "alpha.tsx", path: "ALPHA-MAIN/src/renderer/src/UI/alpha.tsx", dirty: true },
  { name: "builderwindow.tsx", path: "ALPHA-MAIN/src/renderer/src/views/builderwindow.tsx", dirty: true },
];

export function BuilderWindow() {
  const [view, setView] = useState<ActivityView>("explorer");
  const [tabs, setTabs] = useState<OpenTab[]>(initialTabs);
  const [activeTab, setActiveTab] = useState<string>(initialTabs[0].path);
  const [mode, setMode] = useState<EditorMode>("code");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight] = useState(260);
  const [folderOpen, setFolderOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const activeTabObj = tabs.find((t) => t.path === activeTab) ?? tabs[0];
  const fileName = activeTabObj?.name ?? "alpha.tsx";
  const breadcrumbPath = fileBreadcrumb[fileName] ?? fileName;
  const showWelcome = !folderOpen || tabs.length === 0;

  const handleOpenFile = useCallback((name: string, path: string) => {
    setTabs((prev) => prev.some((t) => t.path === path) ? prev : [...prev, { name, path, dirty: false }]);
    setActiveTab(path);
  }, []);

  const handleCloseTab = useCallback((path: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.path !== path);
      if (path === activeTab) {
        if (next.length > 0) {
          const fallback = next[Math.max(0, idx - 1)];
          setActiveTab(fallback.path);
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

  const handleMenuAction = useCallback((menuId: string, label: string) => {
    const l = label.toLowerCase();
    if (menuId === "terminal") { setTerminalOpen(true); return; }
    if (menuId === "more") {
      if (l.includes("settings")) { setShowSettings(true); setShowProfile(false); return; }
      if (l.includes("welcome")) { setFolderOpen(false); return; }
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
      if (l.includes("open folder")) { setFolderOpen(true); return; }
      if (l.includes("new text file") || l.includes("new file")) {
        const name = "untitled.txt";
        const path = `ALPHA-MAIN/${name}`;
        setTabs((prev) => prev.some((t) => t.path === path) ? prev : [...prev, { name, path, dirty: true }]);
        setActiveTab(path);
        setFolderOpen(true);
        return;
      }
    }
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#1e1e1e] text-[#cccccc]">
      <TitleBar onMenuAction={handleMenuAction} />
      <div className="flex min-h-0 flex-1">
        <ActivityBar
          active={showSettings ? "explorer" : showProfile ? "account" : view}
          onSelect={handleActivitySelect}
          onSettingsClick={handleSettingsClick}
        />

        {showSettings ? (
          <aside className="w-[420px] shrink-0 border-r border-[#2b2b2b]">
            <SettingsPanel onClose={() => setShowSettings(false)} />
          </aside>
        ) : showProfile ? (
          <aside className="w-[320px] shrink-0 border-r border-[#2b2b2b]">
            <ProfilePanel onClose={() => setShowProfile(false)} />
          </aside>
        ) : view === "agent" ? (
          <aside className="w-[320px] shrink-0 border-r border-[#2b2b2b]"><CodingAgent /></aside>
        ) : view === "search" ? (
          <aside className="w-[280px] shrink-0 border-r border-[#2b2b2b]"><SearchPanel /></aside>
        ) : view === "scm" ? (
          <aside className="w-[280px] shrink-0 border-r border-[#2b2b2b]"><SourceControlPanel /></aside>
        ) : view === "extensions" ? (
          <aside className="w-[300px] shrink-0 border-r border-[#2b2b2b]"><ExtensionsPanel /></aside>
        ) : view === "debug" ? (
          <aside className="w-[280px] shrink-0 border-r border-[#2b2b2b]"><DebugPanel /></aside>
        ) : folderOpen ? (
          <aside className="w-[280px] shrink-0 border-r border-[#2b2b2b]">
            <FileExplorer activePath={activeTab} onOpenFile={handleOpenFile} />
          </aside>
        ) : null}

        <main className="flex min-w-0 flex-1 flex-col">
          {showWelcome ? (
            <WelcomePage onOpenFolder={() => setFolderOpen(true)} />
          ) : (
            <>
              <TabBar
                tabs={tabs} activeTab={activeTab} mode={mode}
                onSelect={setActiveTab} onClose={handleCloseTab} onModeChange={setMode}
              />
              <Breadcrumbs path={breadcrumbPath} />
              <div className="relative min-h-0 flex-1">
                {mode === "code" && <div className="h-full w-full"><FunctionalCodeEditor fileName={fileName} /></div>}
                {mode === "preview" && <div className="h-full w-full"><LivePreview fileName={fileName} /></div>}
                {mode === "split" && (
                  <PanelGroup direction="horizontal" className="h-full w-full">
                    <Panel defaultSize={50} minSize={25}><FunctionalCodeEditor fileName={fileName} /></Panel>
                    <PanelResizeHandle className="w-[3px] bg-[#1e1e1e] transition-colors hover:bg-[#007acc]" />
                    <Panel defaultSize={50} minSize={25}><LivePreview fileName={fileName} /></Panel>
                  </PanelGroup>
                )}
              </div>
              {terminalOpen && (
                <TerminalPanel
                  height={terminalHeight}
                  onClose={() => setTerminalOpen(false)}
                  onMinimize={() => setTerminalOpen(false)}
                />
              )}
            </>
          )}
          <StatusBar fileName={fileName} ln={62} col={23} />
        </main>
      </div>
    </div>
  );
}

export default BuilderWindow;
