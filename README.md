# Quick Switch Sidebar

A small desktop Obsidian plugin. Browse a folder tree with the keyboard or mouse and automatically display the selected Markdown note, canvas, or base in the content area. Browsing keeps focus in the sidebar and reuses one content tab.

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
| Drag a note or folder onto a folder | Move it into that folder |
| Drag into the empty area below the tree | Move the item out to the vault root |
| Right-click a note or folder | Select it and open its context menu without previewing or expanding it |
| Right-click the empty area below the tree | New note, New folder, New canvas, or New base at the vault root |
| Shift+F10 or the Menu key | Open the selected item's context menu |

Assign a shortcut to **Quick Switch Sidebar: Focus sidebar** under **Settings → Hotkeys** to return to browsing quickly.

Folders appear first, with files sorted by name by default. Expanded folders, sort order, and auto-reveal preference are remembered. Selecting a folder leaves the current file visible. The first file opens a new content tab, which subsequent selections reuse. If you pin or close that tab, browsing creates another one.

The toolbar stays above the scrolling tree:

| Button | Action |
| --- | --- |
| New note | Create a note using Obsidian's default-note location setting, then rename it inline |
| New folder | Create and rename a folder inside the selected folder, the selected file's parent, or the vault root if nothing is selected |
| Change sort order | Sort by name, modified time, or created time, ascending or descending; folders stay first and use alphabetical order for time sorts |
| Auto-reveal current file | Toggle following the active note, canvas, or base: expand its parents, select it, and scroll it into view without moving editor focus; off by default |
| Collapse all | Collapse every folder and keep selection on the visible top-level ancestor |

Sort and auto-reveal preferences apply to Quick Switch independently of the built-in File Explorer. Modified-time sorting refreshes when files change. Auto-reveal waits out Quick Switch's own preview events so rapid keyboard browsing does not jump backwards.

Drag and drop moves one item at a time within Quick Switch. Valid destinations are highlighted, and the destination expands after a move. Moves use Obsidian's link-update preferences and reject duplicate names and moving a folder into itself or its descendants. Folder contents move together, including attachments hidden by this view. Custom sibling ordering, multiple-item drags, external drags, and dragging into other panes are not supported.

## Scope and manual checks

Desktop only; shows folders, Markdown notes, canvases, and bases. This adds a separate sidebar view. It does not replace the built-in File Explorer or provide search. Files use Obsidian's normal view and saving behavior. Large notes and embeds may take time to render.

The blank-area menu creates items at the vault root with unique untitled names. Notes and folders enter inline rename; canvases and bases open in their normal Obsidian views (enable the Canvas and Bases core plugins). All three file types appear in the tree and support selection, context menus, rename, and drag/drop. Creation also works with the built-in Files pane closed. Initial file contents follow the [JSON Canvas format](https://jsoncanvas.org/spec/1.0/) and [Bases syntax](https://obsidian.md/help/bases/syntax).

Context menus reuse the built-in File Explorer's handler when an initialized explorer view is available, including its core and community-plugin actions. The clicked item becomes the explorer's only selection, so an unrelated multiple selection cannot be affected. Rename edits the name directly in Quick Switch: Enter or leaving the input saves, and Escape cancels. Files keep their original extension, and Obsidian handles link updates. Multiple selection in Quick Switch is not supported.

This integration uses private Obsidian APIs, which can change between versions. If the explorer or its menu API is unavailable, a native fallback menu offers opening notes in a tab, split, or window, inline rename, deletion through Obsidian's confirmation flow, and `file-menu` contributions. The fallback does not reproduce the complete explorer menu.

Suggested manual checks:

- Expand nested folders, then move between notes with Up / Down: the content should change while keyboard navigation remains in the sidebar.
- Hold Down briefly: the final displayed note should match the final selected note.
- Press Enter to edit, then use your sidebar shortcut to return.
- Rename, create, and delete notes using the normal File Explorer: the tree should refresh.
- Restart Obsidian: expanded folders should be remembered.
- Check all five toolbar buttons with mouse and keyboard. Verify new-note location settings, new-folder placement, all six sort choices, timestamp ties, and persistence after restarting.
- Enable auto-reveal and switch between files in nested folders from other tabs: ancestors should expand without taking editor focus. Check rapid Up/Down browsing, toggle auto-reveal off, and collapse all while it is enabled.
- Drag a disposable note into a collapsed folder, then into the empty area below the tree to move it back to the vault root. Check both short and scrolling trees, selection, link updates, and that dragging does not preview the note. The root drop area should have no visible box or label.
- Move an expanded folder containing nested notes and attachments. Check its contents and expanded state, including after restarting.
- Try a duplicate name, a folder's own descendant, and cancelling a drag with Escape. No files should change on rejected or cancelled drops, and highlights should clear.
- Pin or close the browsing tab, then select another note: a new tab should open.
- Right-click a note and folder, and compare their menus with the built-in File Explorer. Check community-plugin entries and native create, copy, rename, and delete actions on disposable notes.
- Right-click below the tree and create each of the four item types, including with the Files pane closed. Check root placement, duplicate untitled names, inline rename for notes/folders, and canvases/bases appearing in the tree and opening when selected.
- Select several unrelated files in the built-in explorer, then right-click a different note in Quick Switch: only the clicked note should be targeted.
- Open a menu with Shift+F10 or the Menu key, navigate it with arrows, and dismiss it with Escape. Opening a menu must not preview a note or expand a folder.
- Close the Files pane and check the fallback menu. Cancel deletion and confirm the note remains.
- Rename a note and an expanded folder in Quick Switch with the Files pane hidden. Check Enter, Escape, clicking away, duplicate names, and reopening the context menu afterward.

The isolated sidebar checks (context menus, rename, drag/drop, toolbar, sorting, auto-reveal, and settings) run with `node context-menu.test.cjs` (Node.js is only needed for development checks).

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
