// Worker entry file (wrangler.toml "main"). It is the ONLY file that imports "cloudflare:workers", so node tests that load worker.js are untouched.
// The Hub itself is unchanged: this re-exports worker.js's default handler and its Durable Object class, and adds the trial Workflow class.
// Queue #92 Phase 1 of 3. See src/workflow-trial.js for the flow and context/notes/20261118-queue-92-workflows-trial.md for the plan and the keep/drop numbers.
import { WorkflowEntrypoint } from 'cloudflare:workers';
import hub, { ReadMeterStore } from '../worker.js';
import { runReceiptScanTrial, makeHubCaller } from './workflow-trial.js';

export { ReadMeterStore };
export default hub;

export class ReceiptScanTrialWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const origin = (event && event.payload && event.payload.origin) || '';
    if (!origin) throw new Error('ReceiptScanTrialWorkflow: the start request carried no origin, so the Hub cannot be called');
    return await runReceiptScanTrial(event, step, makeHubCaller(hub, this.env, this.ctx, origin));
  }
}
