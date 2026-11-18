// Sign-in and invite pages: one Show/Hide button per form, so people can check
// what is actually in their password (a phone's suggested password, Caps Lock
// or a different keyboard layout) before they submit. On the invite page it
// shows or hides the password and its confirmation together. Also warns while
// Caps Lock is on. The pages still work without this script.
document.querySelectorAll('.password-wrap').forEach((wrap) => {
  const input = wrap.querySelector('input');
  const toggle = wrap.querySelector('.password-toggle');
  const hint = wrap.parentElement.querySelector('.password-hint');
  // Every password box in the same form follows this one button.
  const form = wrap.closest('form');
  const boxes = form ? [...form.querySelectorAll('.password-wrap input')] : [input];

  if (toggle) {
    toggle.hidden = false;
    toggle.addEventListener('click', () => {
      const show = input.type === 'password';
      boxes.forEach((box) => { box.type = show ? 'text' : 'password'; });
      toggle.textContent = show ? 'Hide' : 'Show';
      toggle.setAttribute('aria-pressed', String(show));
      input.focus();
    });
  }

  if (hint) {
    const update = (event) => {
      if (typeof event.getModifierState === 'function') hint.hidden = !event.getModifierState('CapsLock');
    };
    input.addEventListener('keydown', update);
    input.addEventListener('keyup', update);
    input.addEventListener('blur', () => { hint.hidden = true; });
  }
});

// Never send a password while it is showing as plain text, so the browser
// saves it the normal way.
document.querySelectorAll('form').forEach((form) => {
  form.addEventListener('submit', () => {
    form.querySelectorAll('.password-wrap input').forEach((input) => { input.type = 'password'; });
  });
});
