const { shell } = require('electron');

async function openReport(sessionId) {
  const reportUrl = `${process.env.BACKEND_URL}/reports/${sessionId}`;
  await shell.openExternal(reportUrl);
}

module.exports = { openReport };
