import { Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

@Module({
  imports: [
    WinstonModule.forRootAsync({
      useFactory: () => ({
        level: process.env.LOG_LEVEL ?? 'info',
        transports: [
          new winston.transports.Console({
            format:
              process.env.NODE_ENV === 'production'
                ? winston.format.json()
                : winston.format.combine(
                    winston.format.colorize(),
                    winston.format.timestamp(),
                    winston.format.printf(
                      (info) =>
                        `${info.timestamp as string} ${info.level} [${(info.context as string) ?? 'app'}] ${info.message as string}`,
                    ),
                  ),
          }),
        ],
      }),
    }),
  ],
  exports: [WinstonModule],
})
export class LoggerModule {}
