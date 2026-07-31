#import <React/RCTBridgeModule.h>

// Fire-and-forget: a tile that fails to update must never affect recording.
// See RecorderWidgetSnapshotModule.swift.
@interface RCT_EXTERN_MODULE(RecorderWidgetSnapshot, NSObject)

RCT_EXTERN_METHOD(publish : (NSDictionary *)state)

@end
