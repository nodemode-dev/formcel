import './shim/api';
import '../../frontend/src/main';
import { openSession } from './session';

void openSession(document.documentElement.dataset.demoId ?? 'sales');
