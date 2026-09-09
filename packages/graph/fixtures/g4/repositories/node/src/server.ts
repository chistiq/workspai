import express from 'express';
import { health } from './health.js';

const app = express();
app.get('/health', health);
