// A Monday task from Ask Ombeni, on one of the person's own boards, as them.
// The board must be one they named AND one Monday says they can open;
// otherwise their board names come back so Ombeni can ask which one. Ombeni
// never picks a board on its own.
const people = require('../data/people');
const mondayAuth = require('./mondayAuth');
const mondayService = require('./mondayService');

/** The one board matching what they said, or null (no name, no match, or more than one). */
function pickBoard(boards, said) {
  const wanted = String(said || '').trim().toLowerCase();
  if (!wanted) return null;
  const exact = boards.filter(b => b.name.toLowerCase() === wanted);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const partial = boards.filter(b => b.name.toLowerCase().includes(wanted));
  return partial.length === 1 ? partial[0] : null;
}

async function createMyTask(email, { task, board, due, priority, project }) {
  const token = await mondayAuth.tokenFor(email);
  if (!token) return { error: 'their Monday account isn\'t connected' };
  let boards;
  try {
    boards = await mondayService.listMyBoards(token);
  } catch (err) {
    return { error: `couldn't read their Monday boards (${err.message})` };
  }
  const match = pickBoard(boards, board);
  if (!match) return { boards: boards.map(b => b.name).slice(0, 40) };

  const person = await people.get(email);
  const result = await mondayService.createTask({
    token,
    boardId: match.id,
    task: String(task || '').slice(0, 250),
    ownerUserId: person && person.monday ? person.monday.userId : null,
    due,
    priority,
    project
  });
  return result.created ? { created: true, boardName: match.name } : { error: result.error };
}

module.exports = { createMyTask, pickBoard };
