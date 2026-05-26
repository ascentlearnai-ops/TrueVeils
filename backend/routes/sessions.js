const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const supabase = require('../lib/supabase');

// Create a new interview session
router.post('/', async (req, res) => {
  try {
    const sessionId = uuidv4().replace(/-/g, '').substring(0, 12);
    const candidateBaseUrl = process.env.CANDIDATE_APP_URL || process.env.TRUVEIL_CANDIDATE_APP_URL || process.env.APP_BASE_URL || 'https://truveil-client.vercel.app';
    const candidateLink = `${candidateBaseUrl.replace(/\/+$/, '')}/?code=${encodeURIComponent(sessionId)}#download`;
    const allowedApps = req.body.allowedApps || req.body.allowed_apps || [];
    const allowedSites = req.body.allowedSites || req.body.allowed_sites || [];

    const { error } = await supabase.from('sessions').insert({
      id: sessionId,
      recruiter_id: req.body.recruiterId || null,
      candidate_link: candidateLink,
      status: 'waiting',
      flags: [],
      transcript: [],
      allowed_apps: allowedApps,
      allowed_sites: allowedSites,
      blocking_mode: req.body.blockingMode || req.body.blocking_mode || 'warn_refocus',
      created_at: new Date().toISOString()
    });

    if (error) throw error;

    res.json({ sessionId, candidateLink });
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Get session data
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) return res.status(404).json({ error: 'Session not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

module.exports = router;
