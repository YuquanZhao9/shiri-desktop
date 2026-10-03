'use strict';

// Renders the reminder popup. Text is always inserted with textContent.
function render(items) {
  document.body.replaceChildren(...items.map((item) => {
    const card = document.createElement('div');
    card.className = 'item';
    const head = document.createElement('div');
    head.className = 'head';
    const bell = document.createElement('i');
    bell.className = 'bell';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = item.title;
    title.title = item.title;
    head.append(bell, title);
    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = item.body;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const snooze = document.createElement('button');
    snooze.textContent = '10 分钟后再提醒';
    snooze.addEventListener('click', () => window.reminderPopup.act(item.key, 'snooze'));
    const dismiss = document.createElement('button');
    dismiss.className = 'primary';
    dismiss.textContent = '知道了';
    dismiss.addEventListener('click', () => window.reminderPopup.act(item.key, 'dismiss'));
    actions.append(snooze, dismiss);
    card.append(head, body, actions);
    return card;
  }));
}

window.reminderPopup.onItems(render);
