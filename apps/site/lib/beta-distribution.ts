// Publish URLs only after verifying their signed artifact or store testing state.
type Distribution={ios:{url:string|null;status:string};android:{apkUrl:string|null;playUrl:string|null;status:string}};
export const betaDistribution:Record<'prod'|'dev',Distribution>={
 prod:{ios:{url:null,status:'The production beta is being prepared for TestFlight.'},android:{apkUrl:null,playUrl:null,status:'The production Android beta is being prepared.'}},
 dev:{ios:{url:null,status:'Your private dev build is being prepared.'},android:{apkUrl:null,playUrl:null,status:'Your private dev Android build is being prepared.'}},
};
