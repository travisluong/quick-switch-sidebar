// Run with: node context-menu.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

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
    tree: {
      clearSelectedDoms() { selected = []; },
      selectItem(value) { selected.push(value); },
    },
    openFileContextMenu(evt, el) {
      assert.deepEqual(selected, [item]);
      assert.equal(evt, event);
      assert.equal(el, item.selfEl);
      const menu = new Menu();
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
  console.log('Context-menu checks passed');
}

check().catch(error => { console.error(error); process.exitCode = 1; });
