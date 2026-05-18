package com.isp.common.dto;

import java.time.Instant;
import java.util.List;

public record ErrorResponse(
        ErrorBody error
) {
    public static ErrorResponse of(
            String code,
            String message,
            String correlationId,
            String service,
            List<ErrorDetail> details
    ) {
        return new ErrorResponse(new ErrorBody(
                code,
                message,
                correlationId,
                Instant.now(),
                service,
                details == null ? List.of() : List.copyOf(details)
        ));
    }

    public record ErrorBody(
            String code,
            String message,
            String correlationId,
            Instant timestamp,
            String service,
            List<ErrorDetail> details
    ) {
    }
}
