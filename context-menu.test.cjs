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
        onClick(action) { this.action = action; return this; },
      };
      build(item);
      this.items.push(item);
    }
    addSeparator() {}
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
    require: () => ({ Plugin: class {}, ItemView: class {}, TFile, TFolder, Menu,
      Notice: class { constructor(message) { notices.push(message); } } }),
    module: {}, console: { error() {} },
  };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/main.js`, 'utf8') +
    '\nmodule.exports = QuickSwitchView;', context);
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
      Object.assign(child, { tag, cls: options.cls, ownerDocument: this.ownerDocument });
      this.children.push(child);
      return child;
    }
    querySelector(cls) { return this.children.find(child => '.' + child.cls === cls); }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    empty() { this.children = []; }
    setAttribute() {} removeAttribute() {} toggleClass() {} scrollIntoView() {}
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
  console.log('Context-menu checks passed');
}

check().catch(error => { console.error(error); process.exitCode = 1; });
