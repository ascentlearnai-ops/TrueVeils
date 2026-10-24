const MAX_LENGTH = 5000;
const samples = {
  assisted: {
    text: "First, I would establish a robust incident response process. I would leverage cross-functional collaboration to align stakeholders, identify the root cause, and implement a scalable solution. Finally, I would document best practices to ensure long-term reliability. This demonstrates a holistic approach to problem-solving.",
    eventAt: 105,
  },
  grounded: {
    text: "We rolled back the release first. Actually, the queue was still replaying failed jobs, so I checked the Redis consumers. I traced the bug to our retry handler last week. We patched it, tested 200 failed jobs in staging, and watched the logs for about 30 minutes before deploying again.",
    eventAt: Infinity,
  },
};
module.exports = { samples, MAX_LENGTH };
