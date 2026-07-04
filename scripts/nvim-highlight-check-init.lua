-- Minimal -u init file for scripts/nvim-highlight-check.sh. Wires an
-- isolated scratch runtime (built parser + copied queries) into
-- runtimepath and registers <lang> as the filetype for its own extension.
-- Everything is driven by environment variables set by the wrapper script,
-- not arguments, since `nvim --headless -u ... -c ...` has no clean way to
-- pass positional args through to a subsequent `-c luafile`.

local rtp = assert(vim.env.NVIM_TS_CHECK_RTP, "NVIM_TS_CHECK_RTP not set")
local lang = assert(vim.env.NVIM_TS_CHECK_LANG, "NVIM_TS_CHECK_LANG not set")

vim.opt.runtimepath:prepend(rtp)
vim.filetype.add({ extension = { [lang] = lang } })
