const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

async function create(recruiterId) {
  const res = await fetch(`${process.env.BACKEND_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recruiterId })
  });

  if (!res.ok) throw new Error('Failed to create session');
  const data = await res.json();

  return {
    sessionId: data.sessionId,
    candidateLink: data.candidateLink
  };
}

module.exports = { create };
