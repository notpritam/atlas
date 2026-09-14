// Publish URLs only after verifying their signed artifact or store testing state.
type Distribution={ios:{url:string|null;status:string};android:{apkUrl:string|null;playUrl:string|null;status:string}};
export const betaDistribution:Record<'prod'|'dev',Distribution>={
 prod:{ios:{url:null,status:'FoundKeep 1.0.0 (build 22) is signed for TestFlight. Upload and Apple processing are pending; external testing also requires beta review.'},android:{apkUrl:'https://foundkeep.app/downloads/foundkeep-android-1.0.0-6.apk',playUrl:null,status:'FoundKeep 1.0.0 (build 6) is available as a signed APK.'}},
 dev:{ios:{url:null,status:'Your private dev build is being prepared.'},android:{apkUrl:null,playUrl:null,status:'Your private dev Android build is being prepared.'}},
};
