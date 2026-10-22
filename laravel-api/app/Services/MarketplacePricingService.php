<?php

namespace App\Services;

use Illuminate\Http\Exceptions\HttpResponseException;
use RuntimeException;

class MarketplacePricingService
{
    private const DELIVERY_MINUTES = [
        'NORMAL' => null,
        'RUSH_24_HOURS' => 1440,
        'RUSH_12_HOURS' => 720,
        'RUSH_6_HOURS' => 360,
        'RUSH_3_HOURS' => 180,
    ];

    private const FASTEST_MINUTES = [
        'HOURS_24' => 1440,
        'HOURS_12' => 720,
        'HOURS_6' => 360,
        'HOURS_3' => 180,
    ];

    public function eligibleDeliveryOptions(array $terms): array
    {
        $this->validateTerms($terms);
        $options = ['NORMAL'];
        if (! $terms['acceptsRushOrders'] || ! $terms['fastestRushTier']) {
            return $options;
        }
        $minimum = self::FASTEST_MINUTES[$terms['fastestRushTier']];
        foreach (['RUSH_24_HOURS', 'RUSH_12_HOURS', 'RUSH_6_HOURS', 'RUSH_3_HOURS'] as $option) {
            $minutes = self::DELIVERY_MINUTES[$option];
            if ($minutes < $terms['normalDeliveryMinutes'] && $minutes >= $minimum) {
                $options[] = $option;
            }
        }

        return $options;
    }

    public function quote(array $terms, string $option): array
    {
        if (! array_key_exists($option, self::DELIVERY_MINUTES)) {
            throw $this->badRequest('Select a valid delivery option');
        }
        if (! in_array($option, $this->eligibleDeliveryOptions($terms), true)) {
            throw $this->badRequest('The selected delivery option is not available for this service');
        }

        $feeBasisPoints = $this->bounded('campusgig.platform_fee_basis_points', 0, 10000);
        $feeMinimum = $this->bounded('campusgig.platform_fee_min_centavos', 0, PHP_INT_MAX);
        $rushBasisPoints = $option === 'NORMAL' ? 0 : $this->bounded("campusgig.rush_basis_points.{$option}", 0, 10000);
        $rush = $this->ceilBasisPoints($terms['basePriceCentavos'], $rushBasisPoints);
        $subtotal = $terms['basePriceCentavos'] + $rush;
        $calculatedFee = $this->ceilBasisPoints($subtotal, $feeBasisPoints);
        $fee = $feeBasisPoints === 0 ? 0 : max($feeMinimum, $calculatedFee);

        return [
            'pricingModel' => 'SINGLE_PRICE_V2', 'currency' => 'PHP',
            'basePriceCentavos' => $terms['basePriceCentavos'], 'deliveryOption' => $option,
            'deliveryDurationMinutes' => $option === 'NORMAL' ? $terms['normalDeliveryMinutes'] : self::DELIVERY_MINUTES[$option],
            'rushSurchargeCentavos' => $rush, 'providerServiceSubtotalCentavos' => $subtotal,
            'platformFeeCentavos' => $fee, 'clientTotalCentavos' => $subtotal + $fee,
            'platformFeeBasisPoints' => $feeBasisPoints, 'rushBasisPoints' => $rushBasisPoints,
            'pricingPolicyVersion' => 1,
        ];
    }

    public function platformFee(int $subtotalCentavos): int
    {
        $basisPoints = $this->bounded('campusgig.platform_fee_basis_points', 0, 3000);
        $minimum = $this->bounded('campusgig.platform_fee_min_centavos', 0, PHP_INT_MAX);
        if ($basisPoints === 0) {
            return 0;
        }

        return max($minimum, $this->ceilBasisPoints($subtotalCentavos, $basisPoints));
    }

    private function validateTerms(array $terms): void
    {
        if (! is_int($terms['basePriceCentavos']) || $terms['basePriceCentavos'] <= 0
            || ! is_int($terms['normalDeliveryMinutes']) || $terms['normalDeliveryMinutes'] <= 0
            || ! is_int($terms['includedRevisionLimit']) || $terms['includedRevisionLimit'] < 0) {
            throw $this->badRequest('This service has invalid pricing terms');
        }
        if ($terms['acceptsRushOrders'] !== (bool) $terms['fastestRushTier'] || ($terms['fastestRushTier'] && ! isset(self::FASTEST_MINUTES[$terms['fastestRushTier']]))) {
            throw $this->badRequest('This service has invalid rush settings');
        }
    }

    private function ceilBasisPoints(int $amount, int $basisPoints): int
    {
        return intdiv($amount * $basisPoints + 9999, 10000);
    }

    private function bounded(string $key, int $minimum, int $maximum): int
    {
        $value = config($key);
        if (! is_int($value) || $value < $minimum || $value > $maximum) {
            throw new RuntimeException('Marketplace pricing configuration is invalid');
        }

        return $value;
    }

    private function badRequest(string $message): HttpResponseException
    {
        return new HttpResponseException(response()->json(['message' => $message, 'error' => 'Bad Request', 'statusCode' => 400], 400));
    }
}
