// Read-only transport probe; never print credentials, bucket names, or bodies.
import {S3Client,GetObjectCommand,HeadBucketCommand} from "@aws-sdk/client-s3";
const client=new S3Client({
  region:"us-east-1",endpoint:process.env.DO_SPACES_ENDPOINT,
  credentials:{accessKeyId:process.env.DO_SPACES_KEY,secretAccessKey:process.env.DO_SPACES_SECRET},
  forcePathStyle:false,maxAttempts:1,
});
const result={};
for(const [name,command] of [
  ["bucket",new HeadBucketCommand({Bucket:process.env.DO_SPACES_BUCKET})],
  ["absentReceipt",new GetObjectCommand({Bucket:process.env.DO_SPACES_BUCKET,
    Key:"private/provider-attempt-receipts/read-only-recovery-probe-185-does-not-exist.json"})],
]) {
  try {
    const response=await client.send(command);
    response.Body?.destroy();
    result[name]={status:response.$metadata?.httpStatusCode,ok:true};
  } catch(error) {
    result[name]={status:error.$metadata?.httpStatusCode??error.$response?.statusCode??null,
      code:/^[a-zA-Z0-9_]{1,60}$/.test(error.name??"")?error.name:"OTHER",
      xmlCarriageReturnParserFailure:String(error.message).includes("Invalid character '#'"),
      hasRawResponse:!!error.$response};
  }
}
client.destroy();
console.log(JSON.stringify({storageReadOnlyProbe:result}));
