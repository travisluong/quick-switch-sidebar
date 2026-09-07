const { Plugin, ItemView, TFolder, TFile, Notice } = require('obsidian');

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
  }

  render() {
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
        el.addEventListener('click', () => {
          this.tree.focus();
          this.select(index);
          if (isFolder) this.toggle(file);
        });
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

  onKey(event) {
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
