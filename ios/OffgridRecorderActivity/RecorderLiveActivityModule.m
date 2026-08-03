#import <React/RCTBridgeModule.h>

// Fire-and-forget by design: a Live Activity failure must never break recording, so no
// method returns a promise. See RecorderLiveActivityModule.swift.
@interface RCT_EXTERN_MODULE(RecorderLiveActivity, NSObject)

RCT_EXTERN_METHOD(start : (NSDictionary *)state)
RCT_EXTERN_METHOD(update : (NSDictionary *)state)
RCT_EXTERN_METHOD(end)

@end
