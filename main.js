const { Plugin, ItemView, TFolder, TFile, Notice, Menu } = require('obsidian');

const VIEW_TYPE = 'quick-switch-sidebar';

class QuickSwitchView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.rows = [];
    this.selectedPath = null;
    this.targetLeaf = null;
    this.pendingFile = null;
    this.opening = false;
    this.closed = false;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Quick Switch'; }
  getIcon() { return 'folder-tree'; }

  async onOpen() {
    this.tree = this.contentEl.createDiv({ cls: 'quick-switch-tree' });
    this.tree.tabIndex = 0;
    this.tree.setAttribute('role', 'tree');
    this.tree.setAttribute('aria-label', 'Notes and folders');
    this.registerDomEvent(this.tree, 'keydown', event => this.onKey(event));
    for (const event of ['create', 'delete', 'rename']) {
      this.registerEvent(this.app.vault.on(event, () => this.render()));
    }
    this.render();
  }

  async onClose() {
    this.closed = true;
    this.pendingFile = null;
    this.clearDrag();
    this.cancelRename?.();
  }

  render() {
    this.clearDrag();
    this.cancelRename?.();
    const previousIndex = this.rows.findIndex(row => row.file.path === this.selectedPath);
    this.rows = [];
    this.tree.empty();
    const walk = (folder, depth) => {
      const children = folder.children.filter(file => file instanceof TFolder ||
        (file instanceof TFile && file.extension === 'md'));
      children.sort((a, b) => Number(b instanceof TFolder) - Number(a instanceof TFolder) ||
        a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const file of children) {
        const isFolder = file instanceof TFolder;
        const expanded = this.plugin.expanded.has(file.path);
        const el = this.tree.createDiv({ cls: 'quick-switch-row' });
        el.style.paddingLeft = `${8 + depth * 16}px`;
        el.id = `${VIEW_TYPE}-${this.leaf.id || 'tree'}-${this.rows.length}`;
        el.setAttribute('role', 'treeitem');
        el.setAttribute('aria-level', String(depth + 1));
        if (isFolder) el.setAttribute('aria-expanded', String(expanded));
        const marker = el.createSpan({ cls: 'quick-switch-marker' });
        marker.setAttribute('aria-hidden', 'true');
        marker.toggleClass('is-folder', isFolder);
        marker.toggleClass('is-expanded', expanded);
        el.createSpan({ cls: 'quick-switch-label', text: isFolder ? file.name : file.basename });
        el.title = file.path;
        const index = this.rows.length;
        el.draggable = true;
        el.addEventListener('pointerdown', () => { this.suppressClick = false; });
        el.addEventListener('dragstart', event => {
          if (this.cancelRename || this.moving || this.closed ||
              this.app.vault.getAbstractFileByPath(file.path) !== file) {
            event.preventDefault();
            return;
          }
          this.draggedFile = file;
          this.suppressClick = true;
          this.selectedPath = file.path;
          this.pendingFile = null;
          this.updateSelection();
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-quick-switch-file', file.path);
        });
        el.addEventListener('dragend', () => this.clearDrag());
        if (isFolder) this.bindDropTarget(el, file);
        el.addEventListener('click', () => {
          if (this.suppressClick) { this.suppressClick = false; return; }
          this.tree.focus();
          this.select(index);
          if (isFolder) this.toggle(file);
        });
        el.addEventListener('contextmenu', event => this.openContextMenu(event, file));
        this.rows.push({ file, el });
        if (isFolder && expanded) walk(file, depth + 1);
      }
    };
    walk(this.app.vault.getRoot(), 0);
    if (!this.rows.some(row => row.file.path === this.selectedPath)) {
      this.selectedPath = this.rows[Math.max(0, Math.min(previousIndex, this.rows.length - 1))]?.file.path ?? null;
    }
    this.updateSelection();
    if (!this.rows.length) this.tree.createDiv({ text: 'No notes yet.' });
    const rootTarget = this.tree.createDiv({ cls: 'quick-switch-root-drop' });
    rootTarget.setAttribute('role', 'presentation');
    this.bindDropTarget(rootTarget, this.app.vault.getRoot());
  }

  updateSelection() {
    this.tree.removeAttribute('aria-activedescendant');
    for (const row of this.rows) {
      const selected = row.file.path === this.selectedPath;
      row.el.toggleClass('is-selected', selected);
      row.el.setAttribute('aria-selected', String(selected));
      if (selected) {
        this.tree.setAttribute('aria-activedescendant', row.el.id);
        row.el.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  select(index) {
    const row = this.rows[index];
    if (!row) return;
    this.selectedPath = row.file.path;
    this.updateSelection();
    if (row.file instanceof TFile) void this.preview(row.file);
    else this.pendingFile = null;
  }

  toggle(folder) {
    if (this.plugin.expanded.has(folder.path)) this.plugin.expanded.delete(folder.path);
    else this.plugin.expanded.add(folder.path);
    void this.plugin.saveData({ expanded: [...this.plugin.expanded] });
    this.render();
  }

  clearDrag() {
    this.draggedFile = null;
    this.dropTarget?.toggleClass('is-drop-target', false);
    this.dropTarget = null;
  }

  canMove(file, folder) {
    if (this.closed || this.moving || !file || !(folder instanceof TFolder) ||
        !file.parent || file.parent === folder ||
        this.app.vault.getAbstractFileByPath(file.path) !== file ||
        this.app.vault.getAbstractFileByPath(folder.path) !== folder) return false;
    for (let parent = folder; parent; parent = parent.parent) {
      if (parent === file) return false;
    }
    return true;
  }

  bindDropTarget(el, folder) {
    el.addEventListener('dragover', event => {
      if (!this.canMove(this.draggedFile, folder)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      this.dropTarget?.toggleClass('is-drop-target', false);
      this.dropTarget = el;
      el.toggleClass('is-drop-target', true);
    });
    el.addEventListener('dragleave', event => {
      if (event.relatedTarget && el.contains(event.relatedTarget)) return;
      el.toggleClass('is-drop-target', false);
      if (this.dropTarget === el) this.dropTarget = null;
    });
    el.addEventListener('drop', event => {
      const file = this.draggedFile;
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      this.clearDrag();
      void this.moveFile(file, folder);
    });
  }

  async moveFile(file, folder) {
    if (!this.canMove(file, folder)) return;
    const newPath = (folder.isRoot() ? '' : folder.path + '/') + file.name;
    if (this.app.vault.getAbstractFileByPath(newPath)) {
      new Notice('An item with that name already exists in the destination folder.');
      return;
    }
    this.moving = true;
    try {
      await this.renamePath(file, newPath, folder);
    } catch (error) {
      console.error('Quick Switch Sidebar:', error);
      new Notice('Quick Switch could not move that item: ' + error.message);
    } finally {
      this.moving = false;
    }
  }

  async renamePath(file, newPath, revealFolder) {
    const oldPath = file.path;
    await this.app.fileManager.renameFile(file, newPath);
    this.plugin.expanded = new Set([...this.plugin.expanded].map(path =>
      path === oldPath || path.startsWith(oldPath + '/') ? newPath + path.slice(oldPath.length) : path));
    for (let parent = revealFolder; parent?.parent; parent = parent.parent) {
      this.plugin.expanded.add(parent.path);
    }
    this.selectedPath = file.path;
    if (!this.closed) this.render();
    await this.plugin.saveData({ expanded: [...this.plugin.expanded] });
  }

  openContextMenu(event, file) {
    event.preventDefault();
    event.stopPropagation();
    if (this.app.vault.getAbstractFileByPath(file.path) !== file) return;
    this.tree.focus();
    this.selectedPath = file.path;
    this.pendingFile = null;
    this.updateSelection();

    // ponytail: private explorer API for parity; replace when a public menu builder exists.
    for (const leaf of this.app.workspace.getLeavesOfType('file-explorer')) {
      const explorer = leaf.view;
      const item = explorer.fileItems?.[file.path];
      if (item?.file !== file || !item.selfEl ||
          typeof explorer.openFileContextMenu !== 'function' ||
          typeof explorer.tree?.clearSelectedDoms !== 'function' ||
          typeof explorer.tree?.selectItem !== 'function') continue;
      const menuRef = this.app.workspace.on('file-menu', (menu, target) => {
        if (target !== file) return;
        // Core sets its own row as parent after file-menu fires. That row may be
        // hidden, which closes the menu after 500 ms. Anchor this menu here instead.
        const setParentElement = menu.setParentElement.bind(menu);
        menu.setParentElement = () => setParentElement(this.tree);
        menu.setParentElement(this.tree);
      });
      try {
        if (explorer.fileBeingRenamed === file) explorer.onKeyEscInRename();
        explorer.tree.clearSelectedDoms();
        explorer.tree.selectItem(item);
        // Keep core menu actions, but edit names in the visible sidebar. The
        // receiver also covers startRenameFile calls after creating a folder.
        const menuExplorer = new Proxy(explorer, {
          get: (target, key, receiver) => key === 'startRenameFile'
            ? targetFile => this.startRename(targetFile)
            : Reflect.get(target, key, receiver),
        });
        menuExplorer.openFileContextMenu(event, item.selfEl);
        return;
      } catch (error) {
        console.error('Quick Switch Sidebar: native context menu unavailable', error);
        break;
      } finally {
        this.app.workspace.offref(menuRef);
      }
    }

    const menu = new Menu();
    const add = (title, icon, action) => menu.addItem(item => item
      .setTitle(title).setIcon(icon).onClick(async () => {
        try {
          if (this.app.vault.getAbstractFileByPath(file.path) !== file) return;
          await action();
        } catch (error) {
          console.error('Quick Switch Sidebar:', error);
          new Notice('Quick Switch could not complete that file action.');
        }
      }));
    if (file instanceof TFile) {
      add('Open in new tab', 'file-plus', () => this.app.workspace.getLeaf('tab').openFile(file));
      add('Open to the right', 'separator-vertical', () => this.app.workspace.getLeaf('split', 'vertical').openFile(file));
      add('Open in new window', 'picture-in-picture-2', () => this.app.workspace.getLeaf('window').openFile(file));
      menu.addSeparator();
    }
    add('Rename…', 'pencil', () => this.startRename(file));
    add(file instanceof TFolder ? 'Delete folder' : 'Delete file', 'trash-2',
      () => this.app.fileManager.promptForDeletion(file));
    this.app.workspace.trigger('file-menu', menu, file, 'file-explorer-context-menu', this.leaf);
    menu.showAtMouseEvent(event);
  }

  startRename(file) {
    if (this.closed || this.app.vault.getAbstractFileByPath(file.path) !== file) return;
    for (let parent = file.parent; parent?.parent; parent = parent.parent) {
      this.plugin.expanded.add(parent.path);
    }
    this.selectedPath = file.path;
    this.pendingFile = null;
    this.render();
    const row = this.rows.find(row => row.file === file);
    if (!row) return;
    const label = row.el.querySelector('.quick-switch-label');
    label.hide();
    const input = row.el.createEl('input', {
      cls: 'quick-switch-rename', attr: { 'aria-label': 'Rename ' + file.name },
    });
    input.value = file instanceof TFile ? file.basename : file.name;
    let finished = false;
    const finish = focus => {
      if (finished) return;
      finished = true;
      this.cancelRename = null;
      input.remove();
      label.show();
      if (focus && !this.closed) this.tree.focus();
    };
    this.cancelRename = () => finish(false);
    const commit = async focus => {
      if (finished) return;
      const name = input.value.trim();
      finish(focus);
      if (!name || name.startsWith('.') || /[\\/:*?"<>|]/.test(name)) {
        new Notice('Enter a valid file or folder name without path separators.');
        return;
      }
      if (this.app.vault.getAbstractFileByPath(file.path) !== file) return;
      const oldPath = file.path;
      const parent = file.parent?.path;
      const newPath = (parent && parent !== '/' ? parent + '/' : '') + name +
        (file instanceof TFile ? '.' + file.extension : '');
      if (newPath === oldPath) return;
      try {
        await this.renamePath(file, newPath);
      } catch (error) {
        console.error('Quick Switch Sidebar:', error);
        new Notice('Quick Switch could not rename that item: ' + error.message);
      }
    };
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); void commit(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(true); }
    });
    input.addEventListener('blur', () => void commit(false));
    for (const event of ['click', 'contextmenu']) {
      input.addEventListener(event, event => event.stopPropagation());
    }
    input.focus();
    input.select();
  }

  onKey(event) {
    if (!event.ctrlKey && !event.metaKey && !event.altKey &&
        (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
      const row = this.rows.find(row => row.file.path === this.selectedPath);
      if (row) {
        event.preventDefault();
        event.stopPropagation();
        const rect = row.el.getBoundingClientRect();
        const MouseEvent = this.tree.ownerDocument.defaultView.MouseEvent;
        this.openContextMenu(new MouseEvent('contextmenu', {
          clientX: rect.left + 12, clientY: rect.bottom, button: 2,
        }), row.file);
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const index = this.rows.findIndex(row => row.file.path === this.selectedPath);
    const file = this.rows[index]?.file;
    if (event.key === 'ArrowUp') this.select(Math.max(0, index - 1));
    if (event.key === 'ArrowDown') this.select(Math.min(this.rows.length - 1, index + 1));
    if (event.key === 'Home') this.select(0);
    if (event.key === 'End') this.select(this.rows.length - 1);
    if (event.key === 'ArrowRight' && file instanceof TFolder) {
      if (!this.plugin.expanded.has(file.path)) this.toggle(file);
      else if (this.rows[index + 1]?.file.parent === file) this.select(index + 1);
    }
    if (event.key === 'ArrowLeft' && file) {
      if (file instanceof TFolder && this.plugin.expanded.has(file.path)) this.toggle(file);
      else this.select(this.rows.findIndex(row => row.file === file.parent));
    }
    if (event.key === 'Enter') {
      if (file instanceof TFolder) this.toggle(file);
      else if (file) void this.preview(file, true);
    }
  }

  async preview(file, focus = false) {
    this.pendingFile = { file, focus };
    if (this.opening) return;
    this.opening = true;
    try {
      while (this.pendingFile && !this.closed) {
        const request = this.pendingFile;
        this.pendingFile = null;
        // Reuse one normal content pane; never open notes in our sidebar.
        let attached = false;
        this.app.workspace.iterateRootLeaves(leaf => {
          if (leaf === this.targetLeaf) attached = true;
        });
        if (!attached || this.targetLeaf.getViewState().pinned) {
          this.targetLeaf = this.app.workspace.getLeaf('tab');
        }
        const keepTreeFocus = this.tree.ownerDocument.activeElement === this.tree;
        await this.targetLeaf.openFile(request.file, { active: false });
        if (!this.closed && keepTreeFocus) {
          this.app.workspace.setActiveLeaf(this.targetLeaf, { focus: false });
          this.tree.focus();
        }
        if (request.focus && !this.pendingFile && !this.closed) {
          this.app.workspace.setActiveLeaf(this.targetLeaf, { focus: true });
        }
      }
    } catch (error) {
      console.error('Quick Switch Sidebar:', error);
      new Notice('Quick Switch could not open that note.');
    } finally {
      this.opening = false;
    }
  }
}

module.exports = class QuickSwitchPlugin extends Plugin {
  async onload() {
    const data = await this.loadData();
    this.expanded = new Set(Array.isArray(data?.expanded) ? data.expanded : []);
    this.registerView(VIEW_TYPE, leaf => new QuickSwitchView(leaf, this));
    this.addRibbonIcon('folder-tree', 'Focus Quick Switch Sidebar', () => this.activate());
    this.addCommand({ id: 'focus-sidebar', name: 'Focus sidebar', callback: () => this.activate() });
  }

  async activate() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeftLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    leaf.view.tree?.focus();
  }
};
