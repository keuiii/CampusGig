import { Module } from "@nestjs/common";
import { AdminDisputesController } from "./admin-disputes.controller";
import { DisputesController } from "./disputes.controller";
import { DisputesService } from "./disputes.service";
import { DisputeDeadlineReconciler } from "./dispute-deadline-reconciler.service";

@Module({
  controllers: [DisputesController, AdminDisputesController],
  providers: [DisputesService, DisputeDeadlineReconciler],
  exports: [DisputesService],
})
export class DisputesModule {}
