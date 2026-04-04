const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const supabase = require('../lib/supabase');

// Create a new interview session
router.post('/', async (req, res) => {
  try {
    const sessionId = uuidv4().replace(/-/g, '').substring(0, 12);
    const candidateLink = `${process.env.APP_BASE_URL}/download/${sessionId}`;

    const { error } = await supabase.from('sessions').insert({
      id: sessionId,
      recruiter_id: req.body.recruiterId || null,
      candidate_link: candidateLink,
      status: 'waiting',
      flags: [],
      transcript: [],
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
