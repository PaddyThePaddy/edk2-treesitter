-- Opens a real file in a real Neovim buffer, starts the target grammar's
-- treesitter highlighter, and reports (a) any ERROR/MISSING nodes and (b)
-- the resolved highlight captures per non-blank line. This is the "actually
-- validate in Neovim" step CLAUDE.md requires before calling a query file
-- done -- run via scripts/nvim-highlight-check.sh, not directly.

local file = assert(vim.env.NVIM_TS_CHECK_FILE, "NVIM_TS_CHECK_FILE not set")
local lang = assert(vim.env.NVIM_TS_CHECK_LANG, "NVIM_TS_CHECK_LANG not set")
local max_lines = tonumber(vim.env.NVIM_TS_CHECK_MAX_LINES) or 200

vim.cmd("edit " .. vim.fn.fnameescape(file))
local bufnr = vim.api.nvim_get_current_buf()

if vim.bo[bufnr].filetype ~= lang then
  io.stderr:write(
    string.format("WARNING: filetype is %q, expected %q\n", vim.bo[bufnr].filetype, lang)
  )
end

local ok, err = pcall(vim.treesitter.start, bufnr, lang)
if not ok then
  io.stderr:write("ERROR starting treesitter: " .. tostring(err) .. "\n")
  vim.cmd("cquit 1")
end

local parser = vim.treesitter.get_parser(bufnr, lang)
local tree = parser:parse()[1]
local root = tree:root()

-- Pass/fail signal: walk the tree for ERROR/MISSING nodes.
local problem_count = 0
local function walk(node)
  if node:type() == "ERROR" or node:missing() then
    problem_count = problem_count + 1
    local srow, scol, erow, ecol = node:range()
    print(string.format("%s at %d:%d - %d:%d", node:type(), srow + 1, scol, erow + 1, ecol))
  end
  for child in node:iter_children() do
    walk(child)
  end
end
walk(root)

if problem_count > 0 then
  print(string.format("Parse has problems (%d ERROR/MISSING node(s)).", problem_count))
else
  print("Parse OK: no ERROR/MISSING nodes.")
end

-- Spot-check: resolved highlight captures per non-blank line.
print("")
print("Highlight captures (first " .. max_lines .. " non-blank lines):")
local line_count = vim.api.nvim_buf_line_count(bufnr)
local shown = 0
for lnum = 0, line_count - 1 do
  if shown >= max_lines then
    break
  end
  local line = vim.api.nvim_buf_get_lines(bufnr, lnum, lnum + 1, false)[1] or ""
  if line:match("%S") then
    shown = shown + 1
    local seen, order = {}, {}
    for col = 0, #line - 1 do
      local pos = vim.inspect_pos(bufnr, lnum, col)
      for _, c in ipairs(pos.treesitter or {}) do
        if not seen[c.capture] then
          seen[c.capture] = true
          table.insert(order, c.capture)
        end
      end
    end
    print(string.format("%4d | %-60s | %s", lnum + 1, line, table.concat(order, ",")))
  end
end

if problem_count > 0 then
  vim.cmd("cquit 1")
end
