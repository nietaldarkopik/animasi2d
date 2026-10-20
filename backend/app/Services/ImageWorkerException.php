<?php

namespace App\Services;

class ImageWorkerException extends \RuntimeException
{
    public function __construct(string $message, public int $status = 422)
    {
        parent::__construct($message);
    }
}