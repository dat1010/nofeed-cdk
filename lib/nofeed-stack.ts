import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';

export class NofeedStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ——— Your bucket & OAC (same as before) ———
    const bucket = new s3.Bucket(this, 'NofeedBucket', {
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      bucketKeyEnabled: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const oac = new cloudfront.S3OriginAccessControl(this, 'NofeedOAC', {
      originAccessControlName: 'nofeed-oac',
      description: 'Origin Access Control for nofeed bucket',
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    });

    // ——— Lookup your Route53 zone ———
    const zone = route53.HostedZone.fromLookup(this, 'NofeedZone', {
      domainName: 'nofeed.zone',
    });

    // ——— Import your ACM cert (must be in us-east-1) ———
    const certArn = `arn:aws:acm:us-east-1:${this.account}:certificate/76736501-533a-460e-94b9-fded9ef7abc9`;
    const certificate = certificatemanager.Certificate.fromCertificateArn(this, 'NofeedCert', certArn);

    // ——— CloudFront w/ custom domain & cert ———
    const distribution = new cloudfront.Distribution(this, 'NofeedDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket, { originAccessControl: oac }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
      domainNames: ['nofeed.zone'],
      certificate,
    });

    // ——— Point Route53 A-alias at your distro ———
    new route53.ARecord(this, 'NofeedAlias', {
      zone,
      recordName: 'nofeed.zone',                  // or omit to use the zone apex
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    // ——— Bucket policy for CF private access ———
    bucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowCloudFrontServicePrincipal',
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      actions: ['s3:GetObject'],
      resources: [`${bucket.bucketArn}/*`],
      conditions: {
        StringEquals: {
          'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`
        }
      }
    }));
  }
}

