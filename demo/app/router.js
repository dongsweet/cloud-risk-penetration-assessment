'use strict';

const fs = require('fs');
const path = require('path');

module.exports = app => {
  const { router, controller } = app;
  router.get('/', ctx => {
    ctx.type = 'html';
    ctx.body = fs.createReadStream(path.join(app.config.baseDir, 'public', 'index.html'));
  });
  router.get('/health', controller.api.health);
  router.get('/api/v1/dashboard', controller.api.dashboard);
  router.get('/api/v1/projects', controller.api.projects);
  router.post('/api/v1/projects', controller.api.createProject);
  router.get('/api/v1/projects/:id', controller.api.project);
  router.get('/api/v1/graph/:projectId', controller.api.graph);
  router.get('/api/v1/evidence/:projectId', controller.api.evidence);
  router.post('/api/v1/evidence/:projectId/upload', controller.api.uploadEvidence);
  router.post('/api/v1/evidence/:projectId/:evidenceId/extract', controller.api.extractEvidence);
  router.get('/api/v1/risks/:projectId', controller.api.risks);
  router.post('/api/v1/risks/:projectId/calculate', controller.api.calculate);
  router.put('/api/v1/risks/:projectId/config', controller.api.riskConfig);
  router.get('/api/v1/reviews/:projectId', controller.api.reviews);
  router.post('/api/v1/reviews/:reviewId', controller.api.review);
  router.get('/api/v1/followups/:projectId', controller.api.followups);
  router.post('/api/v1/followups/:followupId/regenerate', controller.api.regenerateFollowup);
  router.post('/api/v1/followups/:followupId/answer', controller.api.answerFollowup);
  router.get('/api/v1/tasks/:projectId', controller.api.tasks);
  router.post('/api/v1/tasks/:taskId/status', controller.api.updateTask);
  router.get('/api/v1/audit/:projectId', controller.api.audit);
  router.get('/api/v1/report/:projectId.pdf', controller.api.reportPdf);
  router.get('/api/v1/report/:projectId', controller.api.report);
};
