export const openApi = {
  openapi: '3.0.3',
  info: {
    title: 'Dignity Clinic API',
    version: '0.2.0',
    description: 'Staff API for outpatient registration, the live queue, consultations, prescriptions, laboratory uploads, and follow-up reminders.',
  },
  servers: [{ url: '/api' }],
  components: {
    securitySchemes: {
      session: { type: 'apiKey', in: 'cookie', name: 'dignity_session' },
    },
  },
  security: [{ session: [] }],
  paths: {
    '/health': { get: { summary: 'Liveness', security: [], responses: { '200': { description: 'API is up' } } } },
    '/auth/login': {
      post: { summary: 'Sign in and set the session cookie', security: [], responses: { '200': { description: 'Signed in' }, '401': { description: 'Rejected' } } },
    },
    '/auth/logout': { post: { summary: 'End the session', responses: { '204': { description: 'Signed out' } } } },
    '/auth/me': { get: { summary: 'Current staff user and clinic', responses: { '200': { description: 'Session' } } } },
    '/patients': {
      get: { summary: 'Search patients in the signed-in clinic', responses: { '200': { description: 'Matches' } } },
      post: { summary: 'Register a patient', responses: { '201': { description: 'Created' }, '409': { description: 'Possible duplicate' } } },
    },
    '/patients/{id}': {
      get: { summary: 'Patient chart', responses: { '200': { description: 'Chart' } } },
      patch: { summary: 'Correct demographics', responses: { '200': { description: 'Updated' } } },
    },
    '/patients/{id}/share-links': {
      post: { summary: 'Issue an expiring patient portal link', responses: { '201': { description: 'Link created once' } } },
    },
    '/queue': {
      get: { summary: 'Today’s queue', responses: { '200': { description: 'Entries' } } },
      post: { summary: 'Create a walk-in or appointment and token', responses: { '201': { description: 'Queued' } } },
    },
    '/queue/call-next': { post: { summary: 'Call the next patient', responses: { '200': { description: 'Called' } } } },
    '/appointments': { get: { summary: 'Scheduled appointments for a clinic day', responses: { '200': { description: 'Appointments' } } } },
    '/dashboard': { get: { summary: 'Doctor dashboard counts', responses: { '200': { description: 'Dashboard' } } } },
    '/visits/{id}': { get: { summary: 'Visit record, redacted by role', responses: { '200': { description: 'Visit' } } } },
    '/visits/{id}/consultation': { put: { summary: 'Save a consultation draft', responses: { '200': { description: 'Saved' } } } },
    '/visits/{id}/finalize': { post: { summary: 'Approve the consultation and prescription', responses: { '200': { description: 'Finalized' } } } },
    '/prescriptions/{id}/pdf': { get: { summary: 'Download an approved prescription PDF', responses: { '200': { description: 'PDF' } } } },
    '/labs': { get: { summary: 'Open laboratory orders', responses: { '200': { description: 'Orders' } } } },
    '/lab-orders/{id}/report': { post: { summary: 'Upload a report for an order', responses: { '201': { description: 'Stored' } } } },
    '/tasks': { get: { summary: 'Follow-ups and unreviewed reports', responses: { '200': { description: 'Tasks' } } } },
    '/notifications': { get: { summary: 'Reminder delivery history', responses: { '200': { description: 'Notifications' } } } },
    '/analytics': { get: { summary: 'Operational counts', responses: { '200': { description: 'Analytics' } } } },
    '/audit': { get: { summary: 'Recent audit events', responses: { '200': { description: 'Log' } } } },
  },
} as const;
