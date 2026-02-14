#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PDFExtractorModule, NSObject)

RCT_EXTERN_METHOD(extractText:(NSString *)filePath
                  maxChars:(double)maxChars
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
