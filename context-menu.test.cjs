// Run with: node context-menu.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { setImmediate: nextTurn } = require('node:timers/promises');

async function check() {
  const menus = [], notices = [], actions = [];
  const menuListeners = new Set();
  class TFile { constructor(path) { this.path = path; } }
  class TFolder { constructor(path) { this.path = path; } }
  class Menu {
    constructor() { this.items = []; menus.push(this); }
    addItem(build) {
      const item = {
        setTitle(title) { this.title = title; return this; },
        setIcon() { return this; },
        setChecked(value) { this.checked = value; return this; },
        onClick(action) { this.action = action; return this; },
      };
      build(item);
      this.items.push(item);
    }
    addSeparator() {}
    showAtPosition(position) { this.position = position; }
    setParentElement(el) { this.parentEl = el; return this; }
    showAtMouseEvent(event) {
      this.event = event;
      this.visible = true;
      this.watchedParent = this.parentEl;
    }
    checkVisibility() {
      // Obsidian checks the parent captured at show time every 500 ms.
      if (this.watchedParent && !this.watchedParent.isShown()) this.visible = false;
    }
  }
  const context = {
    require: () => ({ Plugin: class {}, ItemView: class {}, TFile, TFolder, Menu, setIcon() {},
      Notice: class { constructor(message) { notices.push(message); } } }),
    module: {}, console: { error() {} },
  };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/main.js`, 'utf8') +
    '\nthis.PluginClass = module.exports; module.exports = QuickSwitchView;', context);
  const view = new context.module.exports({}, {});
  const file = new TFile('note.md'), folder = new TFolder('folder');
  const files = new Map([[file.path, file], [folder.path, folder]]);
  const event = { preventDefault() {}, stopPropagation() {} };
  const item = { file, selfEl: { isShown: () => false } };
  let selected = [new TFile('unrelated.md')];
  const explorer = {
    fileItems: { [file.path]: item },
    startRenameFile(target) { this.fileBeingRenamed = target; },
    onKeyEscInRename() { this.fileBeingRenamed = null; },
    tree: {
      clearSelectedDoms() { selected = []; },
      selectItem(value) { selected.push(value); },
    },
    openFileContextMenu(evt, el) {
      if (this.fileBeingRenamed === file) return;
      assert.deepEqual(selected, [item]);
      assert.equal(evt, event);
      assert.equal(el, item.selfEl);
      const menu = new Menu();
      menu.addItem(item => item.setTitle('Rename…').onClick(() => this.startRenameFile(file)));
      view.app.workspace.trigger('file-menu', menu, file, 'file-explorer-context-menu');
      // Core assigns the hidden explorer row AFTER notifying plugins.
      menu.setParentElement(item.selfEl);
      menu.showAtMouseEvent(evt);
      actions.push('native');
    },
  };
  let leaves = [{ view: explorer }];
  view.tree = { focus() {}, isShown: () => true, ownerDocument: { defaultView: {
    MouseEvent: class { constructor(type, options) { Object.assign(this, options); }
      preventDefault() {} stopPropagation() {} },
  } } };
  view.updateSelection = () => {};
  view.preview = () => assert.fail('Right-click must not preview');
  view.app = {
    vault: { getAbstractFileByPath: path => files.get(path) },
    workspace: {
      getLeavesOfType: () => leaves,
      getLeaf: (...args) => ({ openFile: async target => actions.push([...args, target]) }),
      on(name, callback) {
        assert.equal(name, 'file-menu');
        menuListeners.add(callback);
        return callback;
      },
      offref: callback => menuListeners.delete(callback),
      trigger: (...args) => {
        actions.push(args);
        for (const callback of menuListeners) callback(...args.slice(1));
      },
    },
    fileManager: {
      promptForFileRename: async target => actions.push(['rename', target]),
      promptForDeletion: async target => actions.push(['delete', target]),
    },
  };
  view.pendingFile = file;
  view.openContextMenu(event, file);
  assert.equal(view.selectedPath, file.path);
  assert.equal(view.pendingFile, null);
  assert.equal(actions.at(-1), 'native');
  assert.equal(menuListeners.size, 0);
  assert.equal(menus.length, 1);
  menus[0].checkVisibility();
  assert.equal(menus[0].visible, true, 'Hidden explorer row must not dismiss the menu');
  assert.equal(menus[0].watchedParent, view.tree);
  view.tree.isShown = () => false;
  menus[0].checkVisibility();
  assert.equal(menus[0].visible, false, 'Hiding Quick Switch should still dismiss its menu');
  view.tree.isShown = () => true;
  const startRename = view.startRename;
  let renameTarget;
  view.startRename = target => { renameTarget = target; };
  await menus[0].items[0].action();
  assert.equal(renameTarget, file, 'Native Rename must edit the sidebar, not the hidden explorer');
  assert.equal(explorer.fileBeingRenamed, undefined);
  view.openContextMenu(event, file);
  assert.equal(menus.length, 2, 'Rename must not block the next context menu');
  explorer.fileBeingRenamed = file;
  view.openContextMenu(event, file);
  assert.equal(explorer.fileBeingRenamed, null, 'Recover a previously stuck native rename');
  assert.equal(menus.length, 3);
  view.startRename = startRename;
  menus.length = 0;

  leaves = [];
  view.openContextMenu(event, file);
  assert.equal(menus[0].items.length, 5);
  assert.equal(menus[0].event, event);
  assert.equal(actions.at(-1)[0], 'file-menu');
  assert.equal(actions.at(-1)[2], file);
  assert.equal(actions.at(-1)[3], 'file-explorer-context-menu');
  await menus[0].items[0].action();
  assert.deepEqual(actions.at(-1), ['tab', file]);
  await menus[0].items[4].action();
  assert.deepEqual(actions.at(-1), ['delete', file]);
  view.openContextMenu(event, folder);
  assert.deepEqual(menus.at(-1).items.map(item => item.title), ['Rename…', 'Delete folder']);

  // A changed private API must leave a usable menu.
  leaves = [{ view: { ...explorer, openFileContextMenu() { throw Error('changed'); } } }];
  view.openContextMenu(event, file);
  assert.equal(menus.at(-1).items.length, 5);
  assert.equal(menuListeners.size, 0, 'Native failures must remove the temporary listener');
  view.app.fileManager.promptForDeletion = async () => { throw Error('denied'); };
  await menus.at(-1).items[4].action();
  assert.equal(notices.length, 1);

  leaves = [];
  view.rows = [{ file, el: { getBoundingClientRect: () => ({ left: 30, bottom: 80 }) } }];
  for (const key of ['F10', 'ContextMenu']) {
    view.onKey({ ...event, key, shiftKey: key === 'F10' });
    assert.equal(menus.at(-1).event.clientX, 42);
    assert.equal(menus.at(-1).event.clientY, 80);
  }
  files.delete(file.path);
  const count = menus.length, actionCount = actions.length;
  view.openContextMenu(event, file);
  await menus.at(-1).items[0].action();
  assert.equal(menus.length, count);
  assert.equal(actions.length, actionCount);

  // Exercise the real inline editor against a small DOM stand-in.
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.style = {}; }
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    createEl(tag, options = {}) {
      const child = new Element();
      Object.assign(child, { tag, cls: options.cls, text: options.text, attrs: options.attr || {}, ownerDocument: this.ownerDocument });
      this.children.push(child);
      return child;
    }
    querySelector(cls) { return this.children.find(child => '.' + child.cls === cls); }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    empty() { this.children = []; }
    addClass() {}
    setAttribute(name, value) { (this.attrs ??= {})[name] = value; }
    removeAttribute() {} scrollIntoView() {}
    getBoundingClientRect() { return { left: 10, bottom: 30 }; }
    toggleClass(name, enabled) { this[name] = enabled; }
    contains(child) { return this.children.includes(child); }
    hide() { this.hidden = true; } show() { this.hidden = false; }
    remove() { this.removed = true; this.listeners.blur?.(); }
    focus() { this.ownerDocument.activeElement = this; }
    select() { this.selected = true; }
  }
  const root = new TFolder('/');
  Object.assign(file, { path: 'note.md', name: 'note.md', basename: 'note', extension: 'md', parent: root });
  Object.assign(folder, { name: 'folder', parent: root, children: [] });
  root.children = [file, folder];
  files.set(file.path, file);
  view.tree = new Element();
  view.leaf = {};
  view.tree.ownerDocument = {};
  view.plugin = { expanded: new Set(['folder', 'folder/nested']), saveData: async () => {} };
  view.plugin.saveSettings = context.PluginClass.prototype.saveSettings;
  view.app.vault.getRoot = () => root;
  let renameCount = 0;
  view.app.fileManager.renameFile = async (target, path) => {
    if (path === 'taken.md') throw Error('File already exists');
    renameCount++;
    files.delete(target.path);
    target.path = path;
    target.name = path.split('/').at(-1);
    if (target instanceof TFile) target.basename = target.name.slice(0, -3);
    files.set(path, target);
    view.render(); // Vault rename event can arrive before renameFile resolves.
  };
  const edit = target => {
    view.startRename(target);
    const input = view.rows.find(row => row.file === target).el.querySelector('.quick-switch-rename');
    assert.equal(view.tree.ownerDocument.activeElement, input);
    assert.equal(input.selected, true);
    return input;
  };
  const key = async (input, key, extra = {}) => {
    input.listeners.keydown({ ...event, key, ...extra });
    await nextTurn();
  };
  let input = edit(file);
  assert.equal(input.value, 'note');
  input.value = 'renamed';
  await key(input, 'Enter');
  assert.equal(file.path, 'renamed.md');
  assert.equal(view.selectedPath, file.path);
  assert.equal(view.cancelRename, null);
  assert.equal(renameCount, 1, 'Removing the editor must not submit a second rename through blur');
  input = edit(file);
  input.value = 'cancelled';
  await key(input, 'Escape');
  assert.equal(file.path, 'renamed.md');
  input = edit(file);
  input.value = '../outside';
  await key(input, 'Enter');
  assert.equal(file.path, 'renamed.md');
  input = edit(file);
  input.value = 'taken';
  await key(input, 'Enter');
  assert.equal(file.path, 'renamed.md');
  assert.match(notices.at(-1), /already exists/);
  input = edit(folder);
  input.value = 'moved';
  input.listeners.blur();
  await nextTurn();
  assert.equal(folder.path, 'moved');
  assert.equal(view.plugin.expanded.has('moved/nested'), true);
  input = edit(file);
  await key(input, 'Enter', { isComposing: true });
  assert.equal(input.removed, undefined);
  await view.onClose();
  assert.equal(input.removed, true);
  assert.equal(renameCount, 2);

  // Drag/drop uses the same move API as rename, with real tree refreshes.
  view.closed = false;
  root.isRoot = () => true;
  folder.isRoot = () => false;
  files.set('/', root);
  const nested = new TFolder('moved/nested');
  Object.assign(nested, { name: 'nested', parent: folder, children: [], isRoot: () => false });
  folder.children = [nested];
  files.set(nested.path, nested);
  const saved = [];
  view.plugin.saveData = async data => saved.push(data);
  view.app.fileManager.renameFile = async (target, path) => {
    renameCount++;
    const oldPath = target.path;
    const parent = files.get(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/');
    target.parent.children = target.parent.children.filter(child => child !== target);
    parent.children.push(target);
    target.parent = parent;
    for (const entry of [...files.values()]) {
      if (entry.path !== oldPath && !entry.path.startsWith(oldPath + '/')) continue;
      files.delete(entry.path);
      entry.path = path + entry.path.slice(oldPath.length);
      files.set(entry.path, entry);
    }
    view.render();
  };
  view.render();
  const dragEvent = () => ({ ...event, prevented: false,
    preventDefault() { this.prevented = true; },
    dataTransfer: { setData() {} },
  });
  const rowFor = target => view.rows.find(row => row.file === target).el;
  let source = rowFor(file), destination = rowFor(folder), drag = dragEvent();
  source.listeners.dragstart(drag);
  assert.equal(view.draggedFile, file);
  assert.equal(view.selectedPath, file.path);
  assert.equal(drag.dataTransfer.effectAllowed, 'move');
  destination.listeners.dragover(drag);
  assert.equal(drag.prevented, true);
  assert.equal(destination['is-drop-target'], true);
  destination.listeners.dragleave({ relatedTarget: destination.children[0] });
  assert.equal(destination['is-drop-target'], true, 'Crossing a label must retain the highlight');
  destination.listeners.drop(drag);
  await nextTurn();
  assert.equal(file.path, 'moved/renamed.md');
  assert.equal(file.parent, folder);
  assert.equal(view.selectedPath, file.path);
  assert.equal(view.draggedFile, null);
  assert.equal(destination['is-drop-target'], false);
  source.listeners.click(); // A trailing click must not preview or toggle.
  assert.equal(view.plugin.expanded.has(folder.path), true);

  source = rowFor(file);
  source.listeners.dragstart(dragEvent());
  const rootTarget = view.tree.children.at(-1);
  assert.equal(rootTarget.cls, 'quick-switch-root-drop', 'Root drop area must follow all rows');
  assert.equal(rootTarget.text, undefined, 'Root drop area must have no visible label');
  const rootDrag = dragEvent();
  rootTarget.listeners.dragover(rootDrag);
  assert.equal(rootDrag.prevented, true);
  assert.equal(rootDrag.dataTransfer.dropEffect, 'move');
  rootTarget.listeners.drop(rootDrag);
  await nextTurn();
  assert.equal(file.path, 'renamed.md', 'Root drops must not add a leading slash');
  assert.equal(file.parent, root);

  const beforeInvalid = renameCount;
  await view.moveFile(folder, folder);
  await view.moveFile(folder, nested);
  await view.moveFile(file, root);
  await view.moveFile(file, file);
  files.set('moved/renamed.md', new TFile('moved/renamed.md'));
  await view.moveFile(file, folder);
  assert.match(notices.at(-1), /already exists/);
  files.delete('moved/renamed.md');
  files.delete(file.path);
  await view.moveFile(file, folder);
  files.set(file.path, file);
  files.delete(folder.path);
  await view.moveFile(file, folder);
  files.set(folder.path, folder);
  assert.equal(renameCount, beforeInvalid, 'Invalid drops must not call the move API');

  const other = new TFolder('other');
  Object.assign(other, { name: 'other', parent: root, children: [], isRoot: () => false });
  root.children.push(other);
  files.set(other.path, other);
  await view.moveFile(folder, other);
  assert.equal(nested.path, 'other/moved/nested');
  assert.equal(view.plugin.expanded.has('other/moved/nested'), true);
  assert.equal(view.plugin.expanded.has('other'), true);
  assert.equal(saved.at(-1).expanded.includes('other/moved'), true);
  assert.equal(view.selectedPath, folder.path);

  const move = view.app.fileManager.renameFile;
  view.app.fileManager.renameFile = async () => { throw Error('denied'); };
  await view.moveFile(file, other);
  assert.equal(file.path, 'renamed.md');
  assert.equal(view.moving, false);
  assert.match(notices.at(-1), /denied/);
  view.app.fileManager.renameFile = move;
  source = rowFor(file);
  destination = rowFor(other);
  drag = dragEvent();
  destination.listeners.dragover(drag);
  assert.equal(drag.prevented, false, 'External drags are not accepted');
  view.startRename(file);
  rowFor(file).listeners.dragstart(drag);
  assert.equal(drag.prevented, true, 'Inline editing must block dragging');
  view.cancelRename();
  source = rowFor(file);
  source.listeners.dragstart(dragEvent());
  source.listeners.dragend();
  assert.equal(view.draggedFile, null);
  source.listeners.dragstart(dragEvent());
  await view.onClose();
  assert.equal(view.draggedFile, null);

  // Blank-space creation always targets root, even with another folder selected.
  view.closed = false;
  view.selectedPath = other.path;
  view.pendingFile = file;
  view.render();
  view.tree.children.at(-1).listeners.contextmenu(event);
  const rootMenu = menus.at(-1);
  assert.deepEqual(rootMenu.items.map(item => item.title),
    ['New note', 'New folder', 'New canvas', 'New base']);
  assert.equal(rootMenu.event, event);
  assert.equal(rootMenu.watchedParent, view.tree);
  assert.equal(view.selectedPath, null);
  assert.equal(view.pendingFile, null);
  const created = [], renamed = [];
  view.startRename = target => renamed.push(target);
  view.app.vault.create = async (path, content) => {
    assert.equal(path.includes('/'), false, 'Create must ignore the selected folder');
    assert.equal(files.has(path), false, 'Create must never overwrite existing files');
    const target = new TFile(path);
    Object.assign(target, { name: path, basename: path.slice(0, path.lastIndexOf('.')),
      extension: path.split('.').at(-1), parent: root });
    root.children.push(target);
    files.set(path, target);
    view.render(); // Creation refreshes the same tree used for existing files.
    created.push({ target, content });
    return target;
  };
  view.app.vault.createFolder = async path => {
    assert.equal(path.includes('/'), false);
    assert.equal(files.has(path), false);
    const target = new TFolder(path);
    files.set(path, target);
    created.push({ target });
    return target;
  };
  for (const entry of rootMenu.items) await entry.action();
  assert.deepEqual(created.map(entry => entry.target.path),
    ['Untitled.md', 'Untitled folder', 'Untitled.canvas', 'Untitled.base']);
  assert.deepEqual(renamed, [created[0].target, created[1].target]);
  assert.deepEqual(actions.filter(action => action[0] === 'tab').slice(-3).map(action => action[1]),
    [created[0].target, created[2].target, created[3].target]);
  assert.deepEqual(JSON.parse(created[2].content), { nodes: [], edges: [] });
  assert.equal(created[3].content, 'views:\n  - type: table\n    name: Table\n');
  const previews = [];
  view.preview = target => previews.push(target);
  for (const { target } of [created[0], created[2], created[3]]) {
    const index = view.rows.findIndex(row => row.file === target);
    assert.notEqual(index, -1, target.path + ' must appear in the tree');
    assert.equal(view.rows[index].el.querySelector('.quick-switch-label').text, target.basename);
    assert.equal(view.rows[index].el.querySelector('.quick-switch-file-type')?.text,
      target.extension === 'md' ? undefined : target.extension.toUpperCase());
    view.select(index);
    assert.equal(previews.at(-1), target, 'Selecting the row must open that file');
    assert.equal(view.selectedPath, target.path);
  }
  for (const entry of rootMenu.items) await entry.action();
  assert.deepEqual(created.slice(4).map(entry => entry.target.path),
    ['Untitled 1.md', 'Untitled folder 1', 'Untitled 1.canvas', 'Untitled 1.base']);
  view.app.vault.create = async () => { throw Error('denied'); };
  await rootMenu.items[0].action();
  assert.match(notices.at(-1), /denied/);
  const createdCount = created.length;
  await view.onClose();
  await rootMenu.items[1].action();
  assert.equal(created.length, createdCount, 'Closed views must not create items');

  // Toolbar, persisted settings, and active-file following use the real view lifecycle.
  const settingsPlugin = new context.PluginClass();
  let stored = { expanded: ['other'], sortOrder: 'invalid', autoReveal: 'yes' };
  settingsPlugin.loadData = async () => stored;
  settingsPlugin.saveData = async data => { stored = data; };
  settingsPlugin.registerView = settingsPlugin.addRibbonIcon = settingsPlugin.addCommand = () => {};
  await settingsPlugin.onload();
  assert.equal(settingsPlugin.sortOrder, 'name-asc');
  assert.equal(settingsPlugin.autoReveal, false);
  assert.equal(settingsPlugin.expanded.has('other'), true);
  view.plugin = settingsPlugin;
  const sample = (name, parent, mtime, ctime) => {
    const path = (parent === root ? '' : parent.path + '/') + name;
    const target = new TFile(path);
    Object.assign(target, { name, basename: name.slice(0, name.lastIndexOf('.')),
      extension: name.split('.').at(-1), parent, stat: { mtime, ctime } });
    files.set(path, target);
    return target;
  };
  const a = sample('a.md', root, 30, 10), b = sample('b.canvas', root, 10, 30);
  const c = sample('c.base', root, 20, 20), deep = sample('deep.md', nested, 1, 1);
  root.children = [c, other, a, b];
  nested.children = [deep];
  let active = deep;
  view.app.workspace.getActiveFile = () => active;
  const vaultEvents = {}, workspaceEvents = {};
  view.app.vault.on = (name, callback) => { vaultEvents[name] = callback; return callback; };
  view.app.workspace.on = (name, callback) => { workspaceEvents[name] = callback; return callback; };
  view.registerEvent = () => {};
  view.registerDomEvent = (el, name, callback) => el.addEventListener(name, callback);
  view.closed = false;
  view.contentEl = new Element();
  view.contentEl.ownerDocument = { activeElement: 'editor' };
  delete view.updateSelection;
  view.preview = () => assert.fail('Toolbar navigation must not open another file');
  await view.onOpen();
  const buttons = view.contentEl.children[0].children;
  assert.deepEqual(buttons.map(button => button.attrs['aria-label']),
    ['New note', 'New folder', 'Change sort order', 'Auto-reveal current file', 'Collapse all']);
  assert.equal(buttons.every(button => button.tag === 'button' && button.attrs.type === 'button'), true);
  assert.equal(buttons[3].attrs['aria-pressed'], 'false');
  buttons[2].listeners.click({ currentTarget: buttons[2] });
  const sortMenu = menus.at(-1);
  assert.equal(sortMenu.items.length, 6);
  assert.equal(sortMenu.items[0].checked, true);
  const expected = [[a, b, c], [c, b, a], [a, c, b], [b, c, a], [b, c, a], [a, c, b]];
  for (let i = 0; i < 6; i++) {
    await sortMenu.items[i].action();
    assert.deepEqual(Array.from(view.rows).filter(row => row.file instanceof TFile).map(row => row.file), expected[i]);
    assert.equal(view.rows[0].file, other, 'Folders must stay above files');
  }
  await sortMenu.items[2].action();
  b.stat.mtime = 40;
  vaultEvents.modify();
  assert.equal(view.rows.find(row => row.file instanceof TFile).file, b, 'Modified-time sorting must refresh after edits');
  b.stat.mtime = a.stat.mtime;
  vaultEvents.modify();
  assert.equal(view.rows.find(row => row.file instanceof TFile).file, a, 'Timestamp ties use names');
  buttons[3].listeners.click();
  assert.equal(buttons[3].attrs['aria-pressed'], 'true');
  assert.equal(view.selectedPath, deep.path);
  assert.equal(view.rows.some(row => row.file === deep), true);
  assert.equal(view.tree.ownerDocument.activeElement, 'editor', 'Reveal must not steal focus');
  buttons[4].listeners.click();
  assert.equal(settingsPlugin.expanded.size, 0);
  assert.equal(view.selectedPath, other.path, 'Collapse selects the visible ancestor');
  assert.equal(view.rows.some(row => row.file === deep), false);
  view.opening = true;
  workspaceEvents['file-open']();
  assert.equal(view.selectedPath, other.path, 'In-flight previews must not reverse selection');
  view.opening = false;
  workspaceEvents['file-open']();
  assert.equal(settingsPlugin.expanded.size, 0, 'Repeated active-file events must not undo collapse');
  assert.equal(view.selectedPath, other.path);
  assert.equal(buttons[4].attrs['aria-label'], 'Expand all');
  buttons[4].listeners.click();
  assert.deepEqual([...settingsPlugin.expanded].sort(), [other.path, folder.path, nested.path].sort(),
    'Expand all must include folders hidden beneath collapsed parents');
  assert.equal(view.rows.some(row => row.file === deep), true);
  assert.equal(view.selectedPath, other.path, 'Expanding must preserve selection');
  assert.equal(buttons[4].attrs['aria-label'], 'Collapse all');
  assert.deepEqual([...stored.expanded].sort(), [...settingsPlugin.expanded].sort());
  buttons[4].listeners.click();
  assert.equal(settingsPlugin.expanded.size, 0, 'Repeated clicks alternate collapse and expand');
  assert.equal(stored.expanded.length, 0);
  settingsPlugin.expanded.add(nested.path);
  view.render();
  assert.equal(buttons[4].attrs['aria-label'], 'Expand all', 'Hidden expansion state must not prevent expanding');
  buttons[4].listeners.click();
  assert.equal(view.rows.some(row => row.file === deep), true);
  buttons[4].listeners.click();
  active = a;
  workspaceEvents['file-open']();
  assert.equal(view.selectedPath, a.path, 'Switching files resumes auto-reveal');
  active = deep;
  workspaceEvents['file-open']();
  assert.equal(view.selectedPath, deep.path);
  buttons[4].listeners.click();
  buttons[3].listeners.click();
  buttons[3].listeners.click();
  assert.equal(view.selectedPath, deep.path, 'Explicitly enabling auto-reveal reveals the collapsed file');
  for (const unsupported of [null, { extension: 'png' }]) {
    active = unsupported;
    workspaceEvents['file-open']();
    assert.equal(view.selectedPath, deep.path);
  }
  active = a;
  buttons[3].listeners.click();
  workspaceEvents['file-open']();
  assert.equal(view.selectedPath, deep.path, 'Disabled reveal must leave selection alone');
  settingsPlugin.autoReveal = true;
  view.toggle(other);
  await nextTurn();
  await settingsPlugin.onload();
  assert.equal(settingsPlugin.autoReveal, true);
  assert.equal(settingsPlugin.sortOrder, 'mtime-desc', 'Expansion saves must preserve toolbar settings');

  let newPath;
  view.app.fileManager.getNewFileParent = path => { assert.equal(path, a.path); return nested; };
  view.app.vault.create = async path => { newPath = path; return new TFile(path); };
  view.app.vault.createFolder = async path => { newPath = path; return new TFolder(path); };
  await buttons[0].listeners.click();
  assert.equal(newPath, nested.path + '/Untitled.md', 'New note honors the configured destination');
  view.selectedPath = other.path;
  await buttons[1].listeners.click();
  assert.equal(newPath, 'other/Untitled folder');
  view.selectedPath = deep.path;
  await buttons[1].listeners.click();
  assert.equal(newPath, nested.path + '/Untitled folder');
  view.selectedPath = null;
  await buttons[1].listeners.click();
  assert.equal(newPath, 'Untitled folder 2', 'No selection creates a unique root folder');
  await view.onClose();
  console.log('Sidebar checks passed');
}

check().catch(error => { console.error(error); process.exitCode = 1; });
