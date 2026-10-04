-- Not on PATH outside interactive zsh
local claude_bin = vim.fn.expand("~/.local/bin/claude")

local function gated(cmd)
    return function()
        if vim.fn.executable(claude_bin) == 1 then
            vim.cmd(cmd)
        else
            vim.notify("Claude Code is not installed", vim.log.levels.WARN, { title = "Claude" })
        end
    end
end

return {
    "coder/claudecode.nvim",
    keys = {
        { "<C-A-c>", gated("ClaudeCodeFocus"), mode = { "n", "i", "t" }, desc = "Toggle/Focus Claude" },
        { "<leader>af", gated("ClaudeCodeFocus"), desc = "Focus Claude" },
        { "<C-A-r>", gated("ClaudeCode --resume"), mode = { "n", "i", "t" }, desc = "Resume Claude" },
        { "<leader>aC", gated("ClaudeCode --continue"), desc = "Continue Claude" },
    },
    opts = {
        terminal_cmd = claude_bin,
        terminal = {
            split_width_percentage = 0.4,
            auto_insert = false,
            -- Let global Ctrl+/ toggle the shell instead of hiding Claude
            snacks_win_opts = { keys = { hide_slash = false, hide_underscore = false } },
        },
    },
    init = function()
        -- Keep panel at 40% of the terminal width on open and on resize
        local function apply()
            local ok, term = pcall(require, "claudecode.terminal")
            local buf = ok and term.get_active_terminal_bufnr()
            for _, win in ipairs(buf and vim.fn.win_findbuf(buf) or {}) do
                vim.api.nvim_win_set_width(win, math.floor(vim.o.columns * 0.4))
            end
        end
        vim.api.nvim_create_autocmd({ "VimResized", "BufWinEnter" }, {
            group = vim.api.nvim_create_augroup("claude_panel_width", { clear = true }),
            callback = function(ev)
                apply()
                if ev.event == "BufWinEnter" then
                    vim.schedule(apply) -- after plugin layout
                end
            end,
        })
    end,
}
