document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('solution-search');
  if (!input) return;
  const cards = Array.from(document.querySelectorAll('.solution-card'));
  const noResults = document.getElementById('no-results');
  const categoryRow = document.getElementById('category-row');
  const categoryChips = categoryRow ? Array.from(categoryRow.querySelectorAll('.category-chip')) : [];
  let activeCategory = '';

  function applyFilters() {
    const q = input.value.trim().toLowerCase();
    let visible = 0;

    cards.forEach((card) => {
      const matchesText = (card.dataset.search || '').includes(q);
      const matchesCategory = !activeCategory || card.dataset.category === activeCategory;
      const match = matchesText && matchesCategory;
      card.style.display = match ? '' : 'none';
      if (match) visible += 1;
    });

    if (noResults) noResults.style.display = cards.length && visible === 0 ? 'block' : 'none';
  }

  input.addEventListener('input', applyFilters);

  categoryChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      activeCategory = chip.dataset.category || '';
      categoryChips.forEach((c) => c.classList.toggle('is-active', c === chip));
      applyFilters();
    });
  });

  // Press "/" anywhere on the page to jump straight to search, like most
  // internal tools (Linear, GitHub, Slack) — skipped while already typing
  // into a field so it doesn't steal the character.
  document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (e.key === '/' && !typing) {
      e.preventDefault();
      input.focus();
    }
    if (e.key === 'Escape' && document.activeElement === input) {
      input.value = '';
      applyFilters();
      input.blur();
    }
  });
});
