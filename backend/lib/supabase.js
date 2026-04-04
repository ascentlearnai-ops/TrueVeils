// Mocked Supabase client for integration testing without a real DB
const supabase = {
  from: (table) => ({
    insert: async () => ({ data: [], error: null }),
    update: () => ({ eq: async () => ({ data: [], error: null }) }),
    select: () => ({ eq: () => ({ single: async () => ({ data: {}, error: null }) }) })
  })
};

module.exports = supabase;
