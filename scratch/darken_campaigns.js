const fs = require('fs');
const path = require('path');

const targetPath = path.join('d:', 'new-chat', 'app', 'dashboard', 'campaigns', 'page.tsx');
let content = fs.readFileSync(targetPath, 'utf8');

// Replace rules:
const replacements = [
  // 1. Page backgrounds
  {
    from: 'className="h-full flex flex-col md:flex-row bg-[#eae6df] select-none"',
    to: 'className="h-full flex flex-col md:flex-row bg-[#eae6df] dark:bg-[#0b141a] select-none"'
  },
  {
    from: 'className="w-full md:w-[380px] bg-white border-r border-[#e9edef] flex flex-col h-full flex-shrink-0"',
    to: 'className="w-full md:w-[380px] bg-white dark:bg-[#111b21] border-r border-[#e9edef] dark:border-[#202d36] flex flex-col h-full flex-shrink-0"'
  },
  {
    from: 'className="h-[59px] bg-[#f0f2f5] border-b border-[#e9edef] flex items-center justify-between px-4"',
    to: 'className="h-[59px] bg-[#f0f2f5] dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#202d36] flex items-center justify-between px-4"'
  },
  // 2. Metrics / Overview Cards
  {
    from: 'className="p-4 bg-[#f8f9fa] border-b border-[#e9edef] grid grid-cols-2 gap-3"',
    to: 'className="p-4 bg-[#f8f9fa] dark:bg-[#0c1317] border-b border-[#e9edef] dark:border-[#202d36] grid grid-cols-2 gap-3"'
  },
  {
    from: 'className="bg-white p-3 rounded-xl border border-[#e9edef] shadow-sm flex flex-col"',
    to: 'className="bg-white dark:bg-[#1f2c34] p-3 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-sm flex flex-col"'
  },
  // 3. Campaigns List
  {
    from: 'className="flex-1 overflow-y-auto divide-y divide-[#f5f6f6] min-h-0"',
    to: 'className="flex-1 overflow-y-auto divide-y divide-[#f5f6f6] dark:divide-[#202d36]/50 min-h-0 bg-[#f8f9fa] dark:bg-[#0c1317]"'
  },
  {
    from: 'className={`p-3.5 hover:bg-[#f5f6f6] transition-all cursor-pointer flex flex-col gap-1.5 ${\n                    isActive ? \'bg-[#f0f2f5]\' : \'\'\n                  }`}',
    to: 'className={`p-3.5 hover:bg-[#f5f6f6] dark:hover:bg-[#202d36]/50 transition-all cursor-pointer flex flex-col gap-1.5 ${\n                    isActive ? \'bg-[#f0f2f5] dark:bg-[#202d36]\' : \'\'\n                  }`}'
  },
  // 4. Details View Header and Panel
  {
    from: 'className="flex-1 bg-[#f8f9fa] flex flex-col h-full overflow-y-auto scrollbar-thin"',
    to: 'className="flex-1 bg-[#f8f9fa] dark:bg-[#0c1317] flex flex-col h-full overflow-y-auto scrollbar-thin"'
  },
  {
    from: 'className="bg-[#f0f2f5] border-b border-[#e9edef] p-4 flex justify-between items-center flex-shrink-0"',
    to: 'className="bg-[#f0f2f5] dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#202d36] p-4 flex justify-between items-center flex-shrink-0"'
  },
  {
    from: 'className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 bg-white border-b border-[#e9edef] flex-shrink-0"',
    to: 'className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 bg-white dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#202d36] flex-shrink-0"'
  },
  {
    from: 'className="bg-[#f8f9fa] p-3.5 rounded-xl border border-[#e9edef]"',
    to: 'className="bg-[#f8f9fa] dark:bg-[#1f2c34] p-3.5 rounded-xl border border-[#e9edef] dark:border-[#2a3942]"'
  },
  {
    from: 'className="p-4 bg-white border-b border-[#e9edef] flex-shrink-0"',
    to: 'className="p-4 bg-white dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#202d36] flex-shrink-0"'
  },
  {
    from: 'className="p-4 flex flex-col"',
    to: 'className="p-4 flex flex-col bg-[#f8f9fa] dark:bg-[#0c1317]"'
  },
  {
    from: 'className="bg-white border border-[#e9edef] rounded-xl overflow-x-auto shadow-sm"',
    to: 'className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#202d36] rounded-xl overflow-x-auto shadow-sm"'
  },
  // 5. Text elements color adjustments
  {
    from: 'text-[#111b21]',
    to: 'text-[#111b21] dark:text-white',
    allowAll: true
  },
  {
    from: 'text-[#54656f]',
    to: 'text-[#54656f] dark:text-[#8696a0]',
    allowAll: true
  },
  {
    from: 'text-[#667781]',
    to: 'text-[#667781] dark:text-[#8696a0]',
    allowAll: true
  },
  // 6. Pagination Footer
  {
    from: 'className="h-[52px] bg-[#f0f2f5] border-t border-[#e9edef] flex items-center justify-between px-4 flex-shrink-0 select-none"',
    to: 'className="h-[52px] bg-[#f0f2f5] dark:bg-[#111b21] border-t border-[#e9edef] dark:border-[#202d36] flex items-center justify-between px-4 flex-shrink-0 select-none"'
  },
  {
    from: 'className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-[#e9edef] bg-white hover:bg-[#f8f9fa] disabled:opacity-40 transition-all cursor-pointer text-[#54656f] disabled:cursor-not-allowed"',
    to: 'className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#202c33] hover:bg-[#f8f9fa] dark:hover:bg-[#2a3942] disabled:opacity-40 transition-all cursor-pointer text-[#54656f] dark:text-[#8696a0] disabled:cursor-not-allowed"'
  },
  // 7. Modal container
  {
    from: 'className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200"',
    to: 'className="bg-white dark:bg-[#1c282f] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200 border dark:border-[#2a3942]"'
  },
  {
    from: 'className="bg-[#f0f2f5] border-b border-[#e9edef] px-5 py-4 flex items-center justify-between"',
    to: 'className="bg-[#f0f2f5] dark:bg-[#1f2c34] border-b border-[#e9edef] dark:border-[#2a3942] px-5 py-4 flex items-center justify-between"'
  },
  {
    from: 'className="flex-1 p-6 overflow-y-auto space-y-4"',
    to: 'className="flex-1 p-6 overflow-y-auto space-y-4 bg-white dark:bg-[#1c282f]"'
  },
  {
    from: 'className="px-6 py-4 bg-[#f0f2f5] border-t border-[#e9edef] flex items-center justify-between flex-shrink-0 select-none"',
    to: 'className="px-6 py-4 bg-[#f0f2f5] dark:bg-[#1f2c34] border-t border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between flex-shrink-0 select-none"'
  },
  // 8. Wizard inputs and selects
  {
    from: 'className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884]"',
    to: 'className="w-full px-3.5 py-2.5 bg-white dark:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] text-[#111b21] dark:text-white"'
  },
  {
    from: 'className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] font-semibold text-[#111b21]"',
    to: 'className="w-full px-3.5 py-2.5 bg-white dark:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] font-semibold text-[#111b21] dark:text-white"'
  },
  // 9. Wizard Channel buttons
  {
    from: 'className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${\n                            channel === \'whatsapp\'\n                              ? \'bg-[#e7f7f4] border-[#00a884] text-[#008069]\'\n                              : \'bg-white border-[#e9edef] hover:bg-[#f8f9fa] text-[#54656f]\'\n                          }`}',
    to: 'className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${\n                            channel === \'whatsapp\'\n                              ? \'bg-[#e7f7f4] dark:bg-[#002a22] border-[#00a884] text-[#008069] dark:text-[#00e676]\'\n                              : \'bg-white dark:bg-[#2a3942] border-[#e9edef] dark:border-[#2a3942] hover:bg-[#f8f9fa] dark:hover:bg-[#344652] text-[#54656f] dark:text-[#8696a0]\'\n                          }`}'
  },
  {
    from: 'className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${\n                            channel === \'sms\'\n                              ? \'bg-amber-50 border-amber-500 text-amber-700\'\n                              : \'bg-white border-[#e9edef] hover:bg-[#f8f9fa] text-[#54656f]\'\n                          }`}',
    to: 'className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${\n                            channel === \'sms\'\n                              ? \'bg-amber-50 dark:bg-amber-950/20 border-amber-500 text-amber-700 dark:text-amber-500\'\n                              : \'bg-white dark:bg-[#2a3942] border-[#e9edef] dark:border-[#2a3942] hover:bg-[#f8f9fa] dark:hover:bg-[#344652] text-[#54656f] dark:text-[#8696a0]\'\n                          }`}'
  },
  {
    from: 'className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${\n                            channel === \'email\'\n                              ? \'bg-blue-50 border-blue-500 text-blue-700\'\n                              : \'bg-white border-[#e9edef] hover:bg-[#f8f9fa] text-[#54656f]\'\n                          }`}',
    to: 'className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${\n                            channel === \'email\'\n                              ? \'bg-blue-50 dark:bg-blue-950/20 border-blue-500 text-blue-700 dark:text-blue-500\'\n                              : \'bg-white dark:bg-[#2a3942] border-[#e9edef] dark:border-[#2a3942] hover:bg-[#f8f9fa] dark:hover:bg-[#344652] text-[#54656f] dark:text-[#8696a0]\'\n                          }`}'
  },
  // 10. Editor mode tabs
  {
    from: 'className="flex bg-[#f0f2f5] p-0.5 rounded-lg border border-[#e9edef]"',
    to: 'className="flex bg-[#f0f2f5] dark:bg-[#111b21] p-0.5 rounded-lg border border-[#e9edef] dark:border-[#2a3942]"'
  },
  {
    from: 'className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${\n                              editorMode === \'visual\'\n                                ? \'bg-white text-[#111b21] shadow-sm\'\n                                : \'text-[#667781] hover:text-[#111b21]\'\n                            }`}',
    to: 'className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${\n                              editorMode === \'visual\'\n                                ? \'bg-white dark:bg-[#2a3942] text-[#111b21] dark:text-white shadow-sm\'\n                                : \'text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white\'\n                            }`}'
  },
  {
    from: 'className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${\n                              editorMode === \'code\'\n                                ? \'bg-white text-[#111b21] shadow-sm\'\n                                : \'text-[#667781] hover:text-[#111b21]\'\n                            }`}',
    to: 'className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${\n                              editorMode === \'code\'\n                                ? \'bg-white dark:bg-[#2a3942] text-[#111b21] dark:text-white shadow-sm\'\n                                : \'text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white\'\n                            }`}'
  },
  {
    from: 'className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${\n                        detailsPreviewMode === \'preview\'\n                          ? \'bg-white text-[#111b21] shadow-sm\'\n                          : \'text-[#667781] hover:text-[#111b21]\'\n                      }`}',
    to: 'className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${\n                        detailsPreviewMode === \'preview\'\n                          ? \'bg-white dark:bg-[#2a3942] text-[#111b21] dark:text-white shadow-sm\'\n                          : \'text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white\'\n                      }`}'
  },
  {
    from: 'className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${\n                        detailsPreviewMode === \'raw\'\n                          ? \'bg-white text-[#111b21] shadow-sm\'\n                          : \'text-[#667781] hover:text-[#111b21]\'\n                      }`}',
    to: 'className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${\n                        detailsPreviewMode === \'raw\'\n                          ? \'bg-white dark:bg-[#2a3942] text-[#111b21] dark:text-white shadow-sm\'\n                          : \'text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white\'\n                      }`}'
  },
  // 11. Modal Step Content
  {
    from: 'className="border border-[#e9edef] rounded-xl overflow-hidden bg-white focus-within:ring-1 focus-within:ring-[#00a884]"',
    to: 'className="border border-[#e9edef] dark:border-[#2a3942] rounded-xl overflow-hidden bg-white dark:bg-[#2a3942] focus-within:ring-1 focus-within:ring-[#00a884]"'
  },
  {
    from: 'className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] font-mono resize-y text-[#111b21]"',
    to: 'className="w-full px-3.5 py-2.5 bg-white dark:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#00a884] font-mono resize-y text-[#111b21] dark:text-white"'
  },
  {
    from: 'className="mt-1.5 p-3 rounded-lg bg-[#f0f2f5] border border-[#e9edef] text-xs font-mono text-[#54656f] max-w-2xl whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto"',
    to: 'className="mt-1.5 p-3 rounded-lg bg-[#f0f2f5] dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] text-xs font-mono text-[#54656f] dark:text-[#8696a0] max-w-2xl whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto"'
  },
  // 12. Wizard tables & Step 4 confirmation cards
  {
    from: 'className="bg-white p-4 rounded-xl border border-[#e9edef] shadow-sm space-y-3"',
    to: 'className="bg-white dark:bg-[#1f2c34] p-4 rounded-xl border border-[#e9edef] dark:border-[#2a3942] shadow-sm space-y-3"'
  },
  {
    from: 'className="bg-white/80 p-3 rounded-lg border border-[#e9edef] text-xs max-w-[85%] relative self-start shadow-sm leading-relaxed text-[#111b21] rounded-tl-none font-sans"',
    to: 'className="bg-white dark:bg-[#2a3942] p-3 rounded-lg border border-[#e9edef] dark:border-[#2a3942] text-xs max-w-[85%] relative self-start shadow-sm leading-relaxed text-[#111b21] dark:text-white rounded-tl-none font-sans"'
  },
  {
    from: 'className="h-9 px-4 rounded-xl border border-[#e9edef] bg-white hover:bg-[#f8f9fa] text-xs font-bold text-[#54656f] flex items-center gap-1 transition-all cursor-pointer"',
    to: 'className="h-9 px-4 rounded-xl border border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#2a3942] hover:bg-[#f8f9fa] dark:hover:bg-[#344652] text-xs font-bold text-[#54656f] dark:text-[#8696a0] flex items-center gap-1 transition-all cursor-pointer"'
  },
  {
    from: 'className="bg-[#f0f2f5] p-3 rounded-lg border border-[#e9edef] text-xs font-mono text-[#54656f] whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto"',
    to: 'className="bg-[#f0f2f5] dark:bg-[#111b21] p-3 rounded-lg border border-[#e9edef] dark:border-[#2a3942] text-xs font-mono text-[#54656f] dark:text-[#8696a0] whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto"'
  },
  {
    from: 'className="bg-[#f0f2f5] border border-[#e9edef] rounded-xl p-3 space-y-2"',
    to: 'className="bg-[#f0f2f5] dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] rounded-xl p-3 space-y-2"'
  },
  {
    from: 'className="bg-[#f0f2f5] p-3 rounded-lg border border-[#e9edef] text-xs font-mono text-[#54656f] max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed"',
    to: 'className="bg-[#f0f2f5] dark:bg-[#111b21] p-3 rounded-lg border border-[#e9edef] dark:border-[#2a3942] text-xs font-mono text-[#54656f] dark:text-[#8696a0] max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed"'
  },
  {
    from: 'className="max-h-48 overflow-y-auto border border-[#e9edef] rounded-xl p-2 bg-white space-y-1 scrollbar-thin"',
    to: 'className="max-h-48 overflow-y-auto border border-[#e9edef] dark:border-[#2a3942] rounded-xl p-2 bg-white dark:bg-[#111b21] space-y-1 scrollbar-thin"'
  },
  {
    from: 'className="sticky top-0 bg-[#f0f2f5] border-b border-[#e9edef] text-[#54656f] font-bold"',
    to: 'className="sticky top-0 bg-[#f0f2f5] dark:bg-[#1f2c34] border-b border-[#e9edef] dark:border-[#2a3942] text-[#54656f] dark:text-[#8696a0] font-bold"'
  },
  {
    from: 'className="hover:bg-[#f8f9fa] transition-all"',
    to: 'className="hover:bg-[#f8f9fa] dark:hover:bg-[#1f2c34] transition-all"'
  },
  {
    from: 'className="bg-[#f0f2f5] px-1.5 py-0.5 rounded text-[10px] border border-[#e9edef]"',
    to: 'className="bg-[#f0f2f5] dark:bg-[#2a3942] px-1.5 py-0.5 rounded text-[10px] border border-[#e9edef] dark:border-[#2a3942]"'
  }
];

// Perform replacements
replacements.forEach(r => {
  if (r.allowAll) {
    // Regex replace all occurrences of exact colors in className values
    content = content.split(r.from).join(r.to);
  } else {
    // Exact string replace
    content = content.replace(r.from, r.to);
  }
});

fs.writeFileSync(targetPath, content, 'utf8');
console.log('Successfully patched campaigns page.tsx to support light and dark theme switching!');
