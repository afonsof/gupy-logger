import {Logger} from 'winston';
import * as moment from 'moment';

const DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss.SSS Z';

declare interface IConfig {
    sentry: {
        enabled: boolean,
        dsn?: string,
        level?: string,
    };
    logstash?: {
        enabled?: boolean,
        application?: string,
        host?: string,
        port?: number,
        level?: string,
    };
}

function prepareErrorToLog(error, messages = []) {
    if (messages.length) {
        error.message = `${error.message} :: ${messages.join(',')}`;
    }
    return error;
}

export interface IFactoryInterface {
    config: IConfig;
}

type LoggerFactoryType = ({config}: IFactoryInterface) => Logger;

export const loggerFactoryGenerator = ({winston, consoleTransportClass, sentryTransportClass, logstashTransportClass}): LoggerFactoryType => {
    return ({config}: IFactoryInterface) => {
        const transports = [];
        transports.push(new consoleTransportClass({
            level: config.sentry.level,
        }));

        if (config.sentry.enabled) {
            transports.push(new sentryTransportClass({
                sentryOpts: {
                    dsn: config.sentry.dsn,
                },
                level: 'error',
            }));
        }

        if (config.logstash && config.logstash.enabled && logstashTransportClass) {
            const appendMetaInfo = winston.format((info) => {
                return Object.assign(info, {
                  application: config.logstash.application || 'gupy',
                  pid: process.pid,
                  time: moment.utc().format(DATETIME_FORMAT),
                });
            });

            transports.push(new logstashTransportClass({
                host: config.logstash.host,
                port: config.logstash.port,
                level: config.logstash.level,
                format: winston.format.combine(
                    appendMetaInfo(),
                    winston.format.json(),
                    winston.format.timestamp()
                ),
            }));
        }

        const logger: Logger = winston.createLogger({
            format: winston.format.printf(
                error => `${moment.utc().format(DATETIME_FORMAT)} [${error.level}]: ${error.message}`,
            ),
            transports,
            exitOnError: false,
        });

        const errorFn = logger.error;

        logger.error = (...args) => {
            if (!args || !args.length) return;

            let error;
            const messages = [];
            let object = {};

            args.forEach((arg) => {
                if (arg instanceof Error) {
                    error = arg;
                } else if (typeof arg === 'string') {
                    messages.push(arg);
                } else if (typeof arg === 'object') {
                    object = {...object, ...arg};
                }
            });

            if (error) {
                return errorFn(prepareErrorToLog(error, messages), {...object, stack: error.stack});
            } else {
                return errorFn.apply(logger, args);
            }
        };
        return logger;
    };
};
