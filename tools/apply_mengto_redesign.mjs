import fs from 'node:fs';
import path from 'node:path';

// 1. Update MessageList.tsx focused-inbox-tabs styling
const msgListPath = path.resolve('apps/webmail/src/components/MessageList.tsx');
let msgListContent = fs.readFileSync(msgListPath, 'utf8');

// Replace tab container class
msgListContent = msgListContent.replace(
  'class="flex items-center border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F6] dark:bg-[#1E2025] px-2 overflow-x-auto no-scrollbar flex-shrink-0"',
  'class="flex items-center gap-1 border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F6] dark:bg-[#1A1B20] px-2.5 py-1.5 overflow-x-auto no-scrollbar flex-shrink-0"'
);

// Replace tab button class
const oldTabClass = `class={\`flex items-center gap-2 px-3 py-2.5 text-xs font-medium border-b-2 transition-all cursor-pointer whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 \${
                    isActive()
                      ? "border-[#9E725F] text-[#3C3D3E] dark:text-[#F3F4F6] font-semibold bg-[#F0EEE9]/40 dark:bg-[#252830]/50"
                      : "border-transparent text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#3C3D3E] dark:hover:text-[#F3F4F6] hover:bg-stone-50 dark:hover:bg-[#252830]/20"
                  }\`}`;

const newTabClass = `class={\`flex items-center gap-2 px-3 py-1.5 text-xs rounded-xl transition-all duration-150 cursor-pointer whitespace-nowrap select-none focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 active:scale-95 \${
                    isActive()
                      ? "bg-white dark:bg-[#282624] text-[#9E725F] dark:text-[#E2B7A3] font-semibold shadow-2xs border border-[#9E725F]/30"
                      : "text-[#6E7075] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 border border-transparent font-medium"
                  }\`}`;

msgListContent = msgListContent.replace(oldTabClass, newTabClass);

// Replace category badge
const oldBadge = `class={\`px-1.5 py-0.5 rounded-full text-[10px] font-bold \${
                        isActive()
                          ? "bg-[#9E725F] text-white"
                          : "bg-stone-200 dark:bg-stone-700 text-[#3C3D3E] dark:text-[#F3F4F6]"
                      }\`}`;

const newBadge = `class={\`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold \${
                        isActive()
                          ? "bg-[#9E725F] text-white shadow-2xs"
                          : "bg-[#E8E5DF] dark:bg-[#2E3138] text-[#3C3D3E] dark:text-[#E2DFD8]"
                      }\`}`;

msgListContent = msgListContent.replace(oldBadge, newBadge);

fs.writeFileSync(msgListPath, msgListContent, 'utf8');
console.log('Updated MessageList.tsx');
