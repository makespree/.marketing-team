import type {Request,onRequest} from 'firebase-functions/v2/https';
import {ApiError,requireWorkspaceAccess,type Services} from './services.js';
import {config} from './config.js';
import {analyticsProjection} from './analytics-model.js';
type Response=Parameters<Parameters<typeof onRequest>[0]>[1];
export async function analyticsApi(request:Request,response:Response,services:Services,path:string){
  await requireWorkspaceAccess(request.get('Authorization'),services);
  if(path!=='/marketing/analytics'||request.method!=='GET')throw new ApiError(405,'method-not-allowed','Analytics is read-only.');
  if(Object.keys(request.query).length)throw new ApiError(400,'invalid-input','Unexpected analytics filter.');
  const result=await services.db.collection('marketingWorkspaces').doc(config.workspaceId).collection('adAnalytics').orderBy('reportDate','desc').limit(31).get();
  response.json({snapshots:result.docs.slice(0,30).map(d=>analyticsProjection(d.data())),truncated:result.size>30});
}
