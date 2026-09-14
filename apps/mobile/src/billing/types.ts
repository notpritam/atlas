export type Plan = {
  plan:'free'|'pro';pro:boolean;complimentaryPro?:boolean;purchaseAttemptId?:string;
  subscriptions:{provider:'stripe'|'revenuecat';status:string;expiresAt:number;renews:boolean;sandbox:boolean;active:boolean}[];
  features:{imports:boolean;mcp:boolean;managedProcessing:boolean};
  limits:{monthlyProcessing:number;maxCaptures:number;maxBytes:number};
  billing:{revenuecat:{available:boolean;publicKey:string|null;appUserId:string;entitlementId:string;productId:string};stripe:{available:boolean;canManage:boolean}};
};

export type AutomationState={available:boolean;enabled:boolean;fetchLinks:boolean;images:boolean;consentVersion:string;pro:boolean;canProcess?:boolean;mode:'instant'|'scheduled'|'manual'|'paused';intervalHours:1|6|24;monthlyLimit:number;nextRunAt:number|null;usage:{used:number;reserved:number;limit:number;monthlyLimit:number}};

export type ProcessingState = {
  job: {id:string;status:string;error:string|null;updatedAt:number} | null;
  processing: {processedAt:number;result:{download?:{status:string;transcriptStatus?:string;notice?:string}|null;sourceError?:string|null}} | null;
};
