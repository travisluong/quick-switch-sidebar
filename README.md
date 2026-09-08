# Quick Switch Sidebar

A small desktop Obsidian plugin. Browse a folder tree with the keyboard or mouse and automatically display the selected Markdown note in the content area. Browsing keeps focus in the sidebar and reuses one content tab.

## Install locally

No build, Node.js, or package installation is required.

1. Find your **vault folder** (the folder containing your notes), not the Obsidian application installation folder.
2. Inside that vault, create `.obsidian/plugins/quick-switch-sidebar/`. If your vault uses a custom configuration folder, use it instead of `.obsidian`.
3. Copy these three files from this project into that folder:
   - `manifest.json`
   - `main.js`
   - `styles.css`
4. Open or restart Obsidian yourself.
5. Under **Settings → Community plugins**, enable community plugins if necessary, then enable **Quick Switch Sidebar**.
6. Click the folder-tree ribbon icon, or run **Quick Switch Sidebar: Focus sidebar** from the command palette.

Example installed path:

```text
YourVault/
  .obsidian/
    plugins/
      quick-switch-sidebar/
        manifest.json
        main.js
        styles.css
```

To update, replace the three files and restart Obsidian. To uninstall, disable the plugin and delete its `quick-switch-sidebar` folder. Your notes are unaffected.

## Use

| Input | Action |
| --- | --- |
| Up / Down | Select a visible item; notes open automatically |
| Right | Expand a folder or enter its first child |
| Left | Collapse a folder or select the parent |
| Home / End | Select the first / last visible item |
| Enter on a note | Focus the displayed note for editing |
| Enter or click on a folder | Expand / collapse it |
| Click on a note | Select and display it |
| Right-click a note or folder | Select it and open its context menu without previewing or expanding it |
| Shift+F10 or the Menu key | Open the selected item's context menu |

Assign a shortcut to **Quick Switch Sidebar: Focus sidebar** under **Settings → Hotkeys** to return to browsing quickly.

Folders appear first, then notes, sorted by name. Expanded folders are remembered. Selecting a folder leaves the current note visible. The first note opens a new content tab, which subsequent selections reuse. If you pin or close that tab, browsing creates another one.

## Scope and manual checks

Desktop only; Markdown notes only. This adds a separate sidebar view. It does not replace the built-in File Explorer or provide search. Notes use Obsidian's normal view and saving behavior. Large notes and embeds may take time to render.

Context menus reuse the built-in File Explorer's handler when an initialized explorer view is available, including its core and community-plugin actions. The clicked item becomes the explorer's only selection, so an unrelated multiple selection cannot be affected. Rename edits the name directly in Quick Switch: Enter or leaving the input saves, and Escape cancels. Notes keep their `.md` extension, and Obsidian handles link updates. Multiple selection in Quick Switch is not supported.

This integration uses private Obsidian APIs, which can change between versions. If the explorer or its menu API is unavailable, a native fallback menu offers opening notes in a tab, split, or window, inline rename, deletion through Obsidian's confirmation flow, and `file-menu` contributions. The fallback does not reproduce the complete explorer menu.

Suggested manual checks:

- Expand nested folders, then move between notes with Up / Down: the content should change while keyboard navigation remains in the sidebar.
- Hold Down briefly: the final displayed note should match the final selected note.
- Press Enter to edit, then use your sidebar shortcut to return.
- Rename, create, and delete notes using the normal File Explorer: the tree should refresh.
- Restart Obsidian: expanded folders should be remembered.
- Pin or close the browsing tab, then select another note: a new tab should open.
- Right-click a note and folder, and compare their menus with the built-in File Explorer. Check community-plugin entries and native create, copy, rename, and delete actions on disposable notes.
- Select several unrelated files in the built-in explorer, then right-click a different note in Quick Switch: only the clicked note should be targeted.
- Open a menu with Shift+F10 or the Menu key, navigate it with arrows, and dismiss it with Escape. Opening a menu must not preview a note or expand a folder.
- Close the Files pane and check the fallback menu. Cancel deletion and confirm the note remains.
- Rename a note and an expanded folder in Quick Switch with the Files pane hidden. Check Enter, Escape, clicking away, duplicate names, and reopening the context menu afterward.

The isolated context-menu checks run with `node context-menu.test.cjs` (Node.js is only needed for development checks).

The plugin has not been tested inside Obsidian; installation and interaction testing are manual.

## Release attestations

GitHub Actions attests `main.js`, `manifest.json`, and `styles.css` when a
GitHub release is published. Attach all three files before publishing the release.
The workflow checks them against the tagged source (allowing Windows line endings
and a UTF-8 BOM), then signs provenance for the exact downloaded bytes. This
plain-JavaScript plugin has no compilation step. Attestations establish provenance;
they are not a security audit of the plugin.

For an existing release or a retry, open **Actions → Attest release assets → Run
workflow**, select `main`, and enter the release tag, such as `1.0.0`.

Verify downloaded assets using GitHub CLI:

```sh
gh attestation verify main.js --repo travisluong/quick-switch-sidebar
gh attestation verify manifest.json --repo travisluong/quick-switch-sidebar
gh attestation verify styles.css --repo travisluong/quick-switch-sidebar
```
