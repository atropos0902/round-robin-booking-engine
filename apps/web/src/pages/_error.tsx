import * as Sentry from '@sentry/nextjs';
import type { NextPageContext } from 'next';
import NextError from 'next/error';

function ErrorPage({ statusCode }: { statusCode: number }) {
  return <NextError statusCode={statusCode} />;
}

ErrorPage.getInitialProps = async (context: NextPageContext) => {
  await Sentry.captureUnderscoreErrorException(context);
  return NextError.getInitialProps(context);
};

export default ErrorPage;
