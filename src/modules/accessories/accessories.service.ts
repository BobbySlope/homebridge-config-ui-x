import * as fs from 'fs-extra';
import { Injectable } from '@nestjs/common';
import { HapClient, ServiceType } from '@oznu/hap-client';
import { ConfigService } from '../../core/config/config.service';
import { Logger } from '../../core/logger/logger.service';

@Injectable()
export class AccessoriesService {
  private hapClient: HapClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) { }

  /**
   * Connects the client to the homebridge service
   * @param client
   */
  public async connect(client) {
    if (!this.configService.homebridgeConfig.bridge.port) {
      this.logger.error(`config.json does not define a port under bridge.port`);
      this.logger.error(`You can correct this automatically by going to the Config editor and clicking save and then restarting Homebridge.`);
    }

    this.hapClient = new HapClient(
      `http://localhost:${this.configService.homebridgeConfig.bridge.port}`,
      this.configService.homebridgeConfig.bridge.pin,
    );

    let services;

    // initial load
    services = await this.loadAccessories();
    this.refreshrefreshCharacteristics(services);
    client.emit('accessories-data', services);

    // handling incoming requests
    const requestHandler = async (msg?) => {
      if (msg.set) {
        const service: ServiceType = services.find(x => x.aid === msg.set.aid && x.iid === msg.set.siid);
        await service.setCharacteristic(msg.set.iid, msg.set.value);
        services = await this.loadAccessories();
        // do a refresh to check if any accessories changed after this action
        setTimeout(() => {
          this.refreshrefreshCharacteristics(services);
        }, 1500);
      }
    };
    client.on('accessory-control', requestHandler);

    // refresh every 3 seconds
    const loadAccessoriesInterval = setInterval(async () => {
      services = await this.loadAccessories();
      client.emit('accessories-data', services);
    }, 3000);

    // clean up on disconnect
    const onEnd = () => {
      client.removeAllListeners('end');
      client.removeAllListeners('disconnect');
      client.removeAllListeners('accessory-control');
      clearInterval(loadAccessoriesInterval);
    };

    client.on('disconnect', onEnd.bind(this));
    client.on('end', onEnd.bind(this));
  }

  /**
   * Refersh the characteristics from Homebridge
   * @param services
   */
  private refreshrefreshCharacteristics(services) {
    services.forEach(service => service.refreshCharacteristics());
  }

  /**
   * Load all the accessories from Homebridge
   * @param refreshServices
   */
  private async loadAccessories(refreshServices?: boolean) {
    return this.hapClient.getAllServices()
      .then(services => {
        return services;
      })
      .catch((e) => {
        if (e.statusCode === 401) {
          this.logger.warn(`Homebridge must be running in insecure mode to view and control accessories from this plugin.`);
        } else {
          this.logger.error(`Failed load accessories from Homebridge: ${e.message}`);
        }
        return [];
      });
  }

  /**
   * Get the accessory layout
   */
  public async getAccessoryLayout(username: string) {
    try {
      const accessoryLayout = await fs.readJson(this.configService.accessoryLayoutPath);
      if (username in accessoryLayout) {
        return accessoryLayout[username];
      } else {
        throw new Error('User not in Acccessory Layout');
      }
    } catch (e) {
      return [
        {
          name: 'Default Room',
          services: [],
        },
      ];
    }
  }

  /**
   * Saves the accessory layout
   * @param user
   * @param layout
   */
  public async saveAccessoryLayout(user: string, layout: object) {
    let accessoryLayout;

    try {
      accessoryLayout = await fs.readJson(this.configService.accessoryLayoutPath);
    } catch (e) {
      accessoryLayout = {};
    }

    accessoryLayout[user] = layout;
    fs.writeJsonSync(this.configService.accessoryLayoutPath, accessoryLayout);
    this.logger.log(`[${user}] Accessory layout changes saved.`);
    return layout;
  }
}
