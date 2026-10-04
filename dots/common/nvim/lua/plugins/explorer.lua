return {
    {
        "folke/snacks.nvim",
        init = function()
            -- `nvim <dir>`: cd into it
            local dir = vim.fn.argc() == 1 and vim.fn.argv(0) or nil
            if dir and vim.fn.isdirectory(dir) == 1 then
                vim.fn.chdir(dir)
            end
        end,
        config = function(_, opts)
            require("snacks").setup(opts)
            -- Explorer sort: dirs, then extension, then name. Snacks hard-codes this in Tree:walk.
            local Tree = getmetatable(require("snacks.explorer.tree"))
            local function ext(n)
                return n.name:match("^.+%.([^.]+)$") or ""
            end
            function Tree:walk(node, fn, o)
                local abort = fn(node)
                if abort ~= nil then
                    return abort
                end
                local children = vim.tbl_values(node.children)
                table.sort(children, function(a, b)
                    if a.dir ~= b.dir then
                        return a.dir
                    end
                    local ea, eb = ext(a), ext(b)
                    if ea ~= eb then
                        return ea < eb
                    end
                    return a.name < b.name
                end)
                for c, child in ipairs(children) do
                    child.last = c == #children
                    if child.dir and (child.open or (o and o.all)) then
                        abort = self:walk(child, fn, o)
                    else
                        abort = fn(child)
                    end
                    if abort then
                        return true
                    end
                end
                return false
            end
        end,
        keys = {
            { "<leader><space>", false },
            { "<leader>e", false },
            {
                "<C-A-e>",
                function()
                    -- Open -> focus if open but unfocused -> close if focused
                    local p = Snacks.picker.get({ source = "explorer" })[1]
                    if p and not p:is_focused() then
                        p:focus("list")
                    else
                        Snacks.explorer({ cwd = LazyVim.root() })
                    end
                end,
                mode = { "n", "i", "v", "t" },
                desc = "Explorer Snacks (root dir)",
            },
            {
                "<C-p>",
                function()
                    local p = Snacks.picker.get({ source = "files" })[1]
                    if p then
                        p:close()
                    else
                        LazyVim.pick("files")()
                    end
                end,
                mode = { "n", "i", "v", "t" },
                desc = "Toggle Find Files (Root Dir)",
            },
        },
        opts = {
            image = { enabled = true },
            explorer = { replace_netrw = false },
            picker = {
                sources = {
                    files = { win = { input = { keys = { ["<C-p>"] = { "close", mode = { "n", "i" } } } } } },
                    explorer = {
                        hidden = true,
                        ignored = true,
                        actions = {
                            confirm = function(picker, item, action)
                                if
                                    item
                                    and not item.dir
                                    and item.file:match("%.pdf$")
                                    and vim.fn.executable("zathura") == 1
                                then
                                    vim.fn.jobstart({ "zathura", item.file }, { detach = true })
                                    return
                                end
                                return require("snacks.explorer.actions").actions.confirm(picker, item, action)
                            end,
                        },
                        win = {
                            list = {
                                keys = {
                                    ["<M-Left>"] = "explorer_close_all",
                                    ["<BS>"] = false,
                                    ["<C-b>"] = "close",
                                },
                            },
                        },
                    },
                },
            },
        },
    },
    {
        "folke/noice.nvim",
        -- free <C-b> for the explorer toggle above
        keys = { { "<c-b>", false, mode = { "i", "n", "s" } } },
    },
}
