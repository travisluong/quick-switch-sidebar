// Run with: node context-menu.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function check() {
  const menus = [], notices = [], actions = [];
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
    showAtMouseEvent(event) { this.event = event; }
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
  const item = { file, selfEl: {} };
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
      actions.push('native');
    },
  };
  let leaves = [{ view: explorer }];
  view.tree = { focus() {}, ownerDocument: { defaultView: {
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
      trigger: (...args) => actions.push(args),
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
  assert.deepEqual(actions, ['native']);
  assert.equal(menus.length, 0);

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
