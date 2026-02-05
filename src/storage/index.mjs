// src/storage/index.mjs

import {
  initDatabase,
  saveScan,
  getRecentScans,
  getScanById,
  getAllScans,
  getProjects,
  getProjectStats,
  getProjectConfigFromDb,
  saveProjectConfigToDb
} from './sqlite.mjs';

export {
  initDatabase,
  saveScan,
  getRecentScans,
  getScanById,
  getAllScans,
  getProjects,
  getProjectStats,
  getProjectConfigFromDb,
  saveProjectConfigToDb
};

export default {
  initDatabase,
  saveScan,
  getRecentScans,
  getScanById,
  getAllScans,
  getProjects,
  getProjectStats,
  getProjectConfigFromDb,
  saveProjectConfigToDb
};
